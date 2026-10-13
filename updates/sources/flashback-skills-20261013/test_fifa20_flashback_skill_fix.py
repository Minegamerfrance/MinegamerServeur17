import ctypes
import hashlib
import struct
from pathlib import Path

from prepare_fifa20_flashback_skill_fix import FLASHBACK_RESOURCE_ID, SKILL_OFFSET, SOURCE_SHA256, build, trampoline


def main():
    source = Path(r"E:\FIFA\FIFA 20\FIFA 20\CardsDLL_Win64_retail.dll")
    prepared, report = build(source.read_bytes())
    assert prepared != source.read_bytes()
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.VirtualAlloc.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.c_uint32]
    kernel.VirtualAlloc.restype = ctypes.c_void_p
    kernel.VirtualProtect.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
    kernel.VirtualProtect.restype = ctypes.c_int
    kernel.VirtualFree.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint32]
    kernel.VirtualFree.restype = ctypes.c_int
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    kernel.FlushInstructionCache.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    kernel.FlushInstructionCache.restype = ctypes.c_int
    address = kernel.VirtualAlloc(None, 4096, 0x3000, 0x04)
    if not address:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        prologue = b"\x57\x48\x89\xcf"
        return_value = b"\x0f\xb6\x87" + struct.pack("<I", SKILL_OFFSET)
        normal = return_value + b"\x5f\xc3"
        alternate = return_value + b"\x0d\x00\x01\x00\x00\x5f\xc3"
        start = len(prologue)
        normal_offset = start + 34
        alternate_offset = normal_offset + len(normal)
        code = prologue + trampoline(address + start, address + alternate_offset, address + normal_offset) + normal + alternate
        ctypes.memmove(address, code, len(code))
        previous_protection = ctypes.c_uint32()
        if not kernel.VirtualProtect(address, 4096, 0x20, ctypes.byref(previous_protection)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.FlushInstructionCache(kernel.GetCurrentProcess(), address, len(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        function = ctypes.WINFUNCTYPE(ctypes.c_uint32, ctypes.c_void_p)(address)
        cases = ((FLASHBACK_RESOURCE_ID, 3, 2), (188545, 3, 3),
                 (188545 + 3 * 16777216, 3, 3), (553806753, 1, 1),
                 (213565, 4, 4), (FLASHBACK_RESOURCE_ID, 2, 2))
        for resource, original_skills, expected_skills in cases:
            for marker in (0xFF, 0):
                card = ctypes.create_string_buffer(512)
                struct.pack_into("<I", card, 0x18, resource)
                card[0x191] = b"\x04"
                card[SKILL_OFFSET] = bytes([original_skills])
                card[0x194] = bytes([marker])
                before = card.raw
                result = function(ctypes.addressof(card))
                assert result == expected_skills | (0x100 if marker != 0xFF else 0)
                assert card.raw[0x191] == 4
                expected = bytearray(before)
                expected[SKILL_OFFSET] = expected_skills
                assert card.raw == expected
        assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA256
        corrupted = bytearray(source.read_bytes())
        corrupted[0x20] ^= 1
        try:
            build(bytes(corrupted))
        except ValueError:
            pass
        else:
            raise AssertionError("Unknown library must be rejected")
        print("PASS: actual x64 trampoline tested in this test process only; Flashback 3 GT, base/TOTW/other players unchanged, 4 MP preserved, both original branch paths preserved. Game DLL untouched.")
    finally:
        if not kernel.VirtualFree(address, 0, 0x8000):
            raise ctypes.WinError(ctypes.get_last_error())


if __name__ == "__main__":
    main()
