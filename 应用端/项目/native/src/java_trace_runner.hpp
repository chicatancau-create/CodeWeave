#pragma once

#include <string_view>

namespace codeweave::execution {

inline constexpr std::string_view kJavaTraceRunner = R"JAVA(
package codeweave.trace;

import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

public final class CodeWeaveTraceRunner {
  private final Path snapshots;
  private int steps;
  private int bytes;
  private int breakpoints;
  private final AtomicReference<IOException> forwardingFailure = new AtomicReference<>();

  private CodeWeaveTraceRunner(Path snapshots) { this.snapshots = snapshots; }

  private static String quote(String value) {
    StringBuilder result = new StringBuilder("\"");
    for (int index = 0; index < value.length(); ++index) {
      char character = value.charAt(index);
      if (character == '"' || character == '\\') result.append('\\').append(character);
      else if (character < 32 || Character.isSurrogate(character)) {
        result.append("\\u");
        for (int shift = 12; shift >= 0; shift -= 4)
          result.append("0123456789abcdef".charAt((character >> shift) & 15));
      } else result.append(character);
    }
    return result.append('"').toString();
  }

  private static String render(Value value) {
    if (value == null) return "null";
    if (value instanceof CharValue) return quote(String.valueOf(((CharValue) value).value()));
    if (value instanceof PrimitiveValue) return value.toString();
    if (value instanceof StringReference) {
      StringReference string = (StringReference) value;
      Field field = string.referenceType().fieldByName("value");
      Value backing = field == null ? null : string.getValue(field);
      // Inspect only a bounded String backing array; never invoke learner methods.
      if (!(backing instanceof ArrayReference)) return "<string>";
      if (((ArrayReference) backing).length() > 1024) return "<long string>";
      String text = string.value();
      return quote(text.substring(0, Math.min(160, text.length()))) + (text.length() > 160 ? "..." : "");
    }
    return "<object>";
  }

  private void capture(ThreadReference thread, String phase) throws Exception {
    if (steps >= 512 || bytes >= 262144) return;
    int count = Math.min(thread.frameCount(), 32);
    for (StackFrame frame : thread.frames(0, count)) {
      Location location = frame.location();
      try {
        if (!location.sourceName().equals("Main.java") || location.lineNumber() <= 0) continue;
      } catch (AbsentInformationException absent) { continue; }
      ++steps;
      StringBuilder variables = new StringBuilder();
      int variableCount = 0;
      try {
        for (LocalVariable variable : frame.visibleVariables()) {
          if (variableCount >= 16) break;
          String name = variable.name();
          if (name.startsWith("__")) continue;
          if (variableCount++ > 0) variables.append(',');
          variables.append(quote(name.substring(0, Math.min(name.length(), 128)))).append(':')
              .append(quote(render(frame.getValue(variable))));
        }
      } catch (AbsentInformationException absent) { /* A valid frame may have no visible locals. */ }
      String record = "{\"line\":" + location.lineNumber() + ",\"phase\":" + quote(phase)
          + ",\"variables\":{" + variables + "}}\n";
      byte[] encoded = record.getBytes(StandardCharsets.UTF_8);
      if (encoded.length <= 8192 && bytes + encoded.length <= 262144) {
        Files.write(snapshots, encoded, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        bytes += encoded.length;
      }
      return;
    }
  }

  private void prepare(ReferenceType type, EventRequestManager manager) throws Exception {
    try {
      if (!type.sourceName().equals("Main.java")) return;
      for (Location location : type.allLineLocations()) {
        if (breakpoints >= 4096 || steps >= 512 || bytes >= 262144) return;
        BreakpointRequest request = manager.createBreakpointRequest(location);
        request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        request.enable();
        ++breakpoints;
      }
    } catch (AbsentInformationException absent) { /* Library/generated types need not have source lines. */ }
  }

  private Thread forward(InputStream input, OutputStream output, String name) {
    Thread thread = new Thread(() -> {
      try (input) { input.transferTo(output); output.flush(); }
      catch (IOException error) { forwardingFailure.compareAndSet(null, error); }
    }, name);
    thread.start();
    return thread;
  }

  private int run() throws Exception {
    LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
    Map<String, Connector.Argument> arguments = connector.defaultArguments();
    arguments.get("main").setValue("Main");
    arguments.get("options").setValue("-cp .");
    arguments.get("suspend").setValue("true");
    VirtualMachine vm = connector.launch(arguments);
    Process process = vm.process();
    Thread output = forward(process.getInputStream(), System.out, "codeweave-java-output");
    Thread errors = forward(process.getErrorStream(), System.err, "codeweave-java-errors");
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      if (process.isAlive()) process.destroyForcibly();
    }, "codeweave-java-cleanup"));
    try {
      process.getOutputStream().close();
      EventRequestManager manager = vm.eventRequestManager();
      ClassPrepareRequest prepared = manager.createClassPrepareRequest();
      if (vm.canUseSourceNameFilters()) prepared.addSourceNameFilter("Main.java");
      prepared.setSuspendPolicy(EventRequest.SUSPEND_ALL);
      prepared.enable();
      ExceptionRequest exceptions = manager.createExceptionRequest(null, false, true);
      exceptions.setSuspendPolicy(EventRequest.SUSPEND_ALL);
      exceptions.enable();
      boolean connected = true;
      while (connected) {
        EventSet events;
        try { events = vm.eventQueue().remove(1000); }
        catch (VMDisconnectedException disconnected) { break; }
        if (events == null) {
          if (!process.isAlive()) break;
          continue;
        }
        try {
          for (Event event : events) {
            if (event instanceof ClassPrepareEvent) prepare(((ClassPrepareEvent) event).referenceType(), manager);
            else if (event instanceof BreakpointEvent) capture(((BreakpointEvent) event).thread(), "line");
            else if (event instanceof ExceptionEvent) capture(((ExceptionEvent) event).thread(), "exception");
            else if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) connected = false;
          }
          if (steps >= 512 || bytes >= 262144) {
            manager.deleteEventRequests(new ArrayList<>(manager.breakpointRequests()));
            prepared.disable();
            exceptions.disable();
          }
        } catch (VMDisconnectedException disconnected) { connected = false; }
        finally {
          try { events.resume(); } catch (VMDisconnectedException disconnected) { connected = false; }
        }
      }
      int exit = process.waitFor();
      output.join();
      errors.join();
      if (forwardingFailure.get() != null) throw forwardingFailure.get();
      return exit;
    } finally {
      if (process.isAlive()) process.destroyForcibly();
      try { vm.dispose(); } catch (VMDisconnectedException disconnected) { /* Already exited. */ }
    }
  }

  public static void main(String[] arguments) {
    try { System.exit(new CodeWeaveTraceRunner(Path.of(arguments[0])).run()); }
    catch (Exception error) {
      System.err.println("CodeWeave Java trace failed: " + error.getClass().getSimpleName());
      System.exit(1);
    }
  }
}
)JAVA";

}  // namespace codeweave::execution
