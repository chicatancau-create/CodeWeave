#pragma once

#include <string_view>

namespace codeweave::execution {

inline constexpr std::string_view kCppTraceRunner = R"GDBPY(
import gdb
import json
import pathlib
import os

root = pathlib.Path(__file__).resolve().parent
snapshots = root / "snapshots.jsonl"
steps = 0
step_bytes = 0
process_handle = None
capture_error = False
disable_queued = False
breakpoints = []
source_path = None
exit_code = None

def fail(error):
    global capture_error
    capture_error = True
    (root / "trace-error").write_text(type(error).__name__, encoding="ascii")

def disable_sampling():
    for breakpoint in breakpoints:
        if breakpoint.is_valid():
            breakpoint.enabled = False

def stop_sampling():
    global disable_queued
    if not disable_queued:
        disable_queued = True
        gdb.post_event(disable_sampling)

def render(value):
    if value.is_optimized_out:
        return "<unavailable>"
    type = value.type.strip_typedefs()
    if type.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF):
        value = value.referenced_value()
        type = value.type.strip_typedefs()
    if type.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL,
                     gdb.TYPE_CODE_FLT, gdb.TYPE_CODE_ENUM):
        return value.format_string(raw=True)
    address = None
    size = 0
    null_terminated = False
    if type.code == gdb.TYPE_CODE_ARRAY and type.target().strip_typedefs().code == gdb.TYPE_CODE_CHAR:
        address, size = value.address, type.sizeof
        null_terminated = True
    elif type.code == gdb.TYPE_CODE_STRUCT and "basic_string<char," in str(type):
        try:
            address = value["_M_dataplus"]["_M_p"]
            size = int(value["_M_string_length"])
        except gdb.error:
            return "<object>"
    if address is not None and size >= 0:
        data = bytes(gdb.selected_inferior().read_memory(int(address), min(size, 160)))
        if null_terminated:
            data = data.split(b"\0", 1)[0]
        text = data.decode("utf-8", errors="replace")
        return json.dumps(text, ensure_ascii=False) + ("..." if size > 160 else "")
    return "<object>"

def capture():
    global steps, step_bytes
    if steps >= 512 or step_bytes >= 262144 or capture_error:
        stop_sampling()
        return
    frame = gdb.newest_frame()
    if frame is None:
        return
    location = frame.find_sal()
    if not location.symtab or location.line <= 0 or os.path.normcase(location.symtab.fullname()) != source_path:
        return
    steps += 1
    variables = {}
    block = frame.block()
    while block is not None and not block.is_global and not block.is_static and len(variables) < 16:
        for symbol in block:
            if len(variables) >= 16:
                break
            name = symbol.name
            if not name or name.startswith("__") or name in variables or not (symbol.is_variable or symbol.is_argument):
                continue
            try:
                variables[name[:128]] = render(frame.read_var(symbol))
            except (gdb.error, RuntimeError, ValueError):
                variables[name[:128]] = "<unavailable>"
        block = block.superblock
    record = json.dumps({"line": location.line, "phase": "line", "variables": variables},
                        ensure_ascii=True, separators=(",", ":")) + "\n"
    encoded = record.encode("utf-8")
    if len(encoded) <= 8192 and step_bytes + len(encoded) <= 262144:
        with snapshots.open("ab") as output:
            output.write(encoded)
        step_bytes += len(encoded)
    if steps >= 512 or step_bytes >= 262144:
        stop_sampling()

class SourceBreakpoint(gdb.Breakpoint):
    def stop(self):
        try:
            capture()
        except Exception as error:
            fail(error)
            stop_sampling()
        return False

def thread_created(event):
    global process_handle
    if process_handle is None:
        try:
            process_handle = _winapi.OpenProcess(0x1000, False, event.inferior_thread.inferior.pid)
        except OSError as error:
            fail(error)

def exited(event):
    global process_handle, exit_code
    code = getattr(event, "exit_code", 1)
    if process_handle is not None:
        try:
            actual_code = _winapi.GetExitCodeProcess(process_handle)
            if actual_code != 259:
                code = actual_code
        finally:
            _winapi.CloseHandle(process_handle)
            process_handle = None
    if capture_error and code == 0:
        code = 1
    if code >= 2147483648:
        code -= 4294967296
    exit_code = code

try:
    import _winapi
    for command in ("set pagination off", "set confirm off", "set auto-load off",
                    "set print thread-events off", "set print inferior-events off",
                    "set suppress-cli-notifications on",
                    "set host-charset UTF-8", "set logging overwrite on",
                    "set logging redirect on", "set logging debugredirect on"):
        gdb.execute(command)
    gdb.execute("set logging file " + (root / "gdb.log").as_posix())
    gdb.execute("set logging enabled on")
    gdb.execute("handle SIGSEGV SIGILL SIGFPE SIGABRT SIGBUS nostop noprint pass")
    main = gdb.lookup_global_symbol("main")
    if main is None or main.symtab is None:
        raise RuntimeError("Source symbols unavailable")
    source_path = os.path.normcase(main.symtab.fullname())
    lines = sorted(set(entry.line for entry in main.symtab.linetable() if entry.line > 0))[:4096]
    for line in lines:
        breakpoint = SourceBreakpoint(source_path.replace("\\", "/") + ":" + str(line), internal=True)
        breakpoint.silent = True
        breakpoints.append(breakpoint)
    gdb.events.new_thread.connect(thread_created)
    gdb.events.exited.connect(exited)
    output_path = (root / "program-output").as_posix()
    gdb.execute('run > "' + output_path + '" 2>&1')
    if exit_code is None:
        raise RuntimeError("Debugged program did not exit")
    gdb.execute("quit " + str(exit_code))
except Exception as error:
    fail(error)
    gdb.execute("quit 1")
)GDBPY";

}  // namespace codeweave::execution
