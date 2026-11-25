package com.codeweave.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LocalServiceOriginTest {
    @Test fun allowsOnlyTheEmulatorHostAndExplicitPort() {
        assertEquals("http://10.0.2.2:4173", LocalServiceOrigin.origin("http://10.0.2.2:4173/"))
    }

    @Test fun rejectsExternalOrAmbiguousOrigins() {
        listOf("http://127.0.0.1:4173", "http://example.test:4173", "http://10.0.2.2:4173/prefix",
            "http://user@10.0.2.2:4173", "http://10.0.2.2:4173/?x=1", "http://10.0.2.2:65536").forEach { input ->
            assertThrows(IllegalArgumentException::class.java) { LocalServiceOrigin.origin(input) }
        }
    }
}
