import hashlib
import json
import os
import struct
import sys
from pathlib import Path


sys.path.insert(0, str(Path(os.environ["TEMP"]) / "mng-native-inspect-libs"))
import capstone
import pefile


SOURCE_SHA256 = "6a7078eb2b707fefb271c66b76ae0af03051da94170c68b832e0e99064ddc783"
PATCH_RVA = 0x2C5022
ORIGINAL_BYTES = bytes.fromhex("80bf94010000ff0f85e2000000")
FLASHBACK_RESOURCE_ID = 537059457
SKILL_OFFSET = 0x192


def aligned(value, alignment):
    return (value + alignment - 1) // alignment * alignment


def override_prefix():
    return (b"\x81\x7f\x18" + struct.pack("<I", FLASHBACK_RESOURCE_ID)
            + b"\x75\x07\xc6\x87" + struct.pack("<I", SKILL_OFFSET) + b"\x02")


def trampoline(address, branch_target, return_target):
    prefix = override_prefix() + ORIGINAL_BYTES[:7]
    conditional = b"\x0f\x85" + struct.pack("<i", branch_target - (address + len(prefix) + 6))
    returning = b"\xe9" + struct.pack("<i", return_target - (address + len(prefix) + 11))
    return prefix + conditional + returning


def build(original):
    if hashlib.sha256(original).hexdigest() != SOURCE_SHA256:
        raise ValueError("Unsupported CardsDLL build; no patch prepared")
    binary = pefile.PE(data=original, fast_load=True)
    if binary.get_data(PATCH_RVA, len(ORIGINAL_BYTES)) != ORIGINAL_BYTES:
        raise ValueError("Native skills branch signature mismatch")
    header_offset = binary.sections[-1].get_file_offset() + 40
    if header_offset + 40 > binary.OPTIONAL_HEADER.SizeOfHeaders or original[header_offset:header_offset + 40] != bytes(40):
        raise ValueError("No verified room for a native patch section")
    file_alignment = binary.OPTIONAL_HEADER.FileAlignment
    section_alignment = binary.OPTIONAL_HEADER.SectionAlignment
    section_address = aligned(max(section.VirtualAddress + max(section.Misc_VirtualSize, section.SizeOfRawData)
                                  for section in binary.sections), section_alignment)
    raw_offset = aligned(len(original), file_alignment)
    branch_target = PATCH_RVA + len(ORIGINAL_BYTES) + struct.unpack_from("<i", ORIGINAL_BYTES, 9)[0]
    code = trampoline(section_address, branch_target, PATCH_RVA + len(ORIGINAL_BYTES))
    raw_size = aligned(len(code), file_alignment)
    patched = bytearray(original)
    patched.extend(bytes(raw_offset + raw_size - len(patched)))
    patched[raw_offset:raw_offset + len(code)] = code
    section_header = struct.pack("<8sIIIIIIHHI", b".mnggt\0\0", len(code), section_address,
                                 raw_size, raw_offset, 0, 0, 0, 0, 0x60000020)
    patched[header_offset:header_offset + 40] = section_header
    struct.pack_into("<H", patched, binary.FILE_HEADER.get_field_absolute_offset("NumberOfSections"), binary.FILE_HEADER.NumberOfSections + 1)
    struct.pack_into("<I", patched, binary.OPTIONAL_HEADER.get_field_absolute_offset("SizeOfImage"), aligned(section_address + len(code), section_alignment))
    struct.pack_into("<I", patched, binary.OPTIONAL_HEADER.get_field_absolute_offset("SizeOfCode"), binary.OPTIONAL_HEADER.SizeOfCode + raw_size)
    patch_offset = binary.get_offset_from_rva(PATCH_RVA)
    jump = b"\xe9" + struct.pack("<i", section_address - (PATCH_RVA + 5))
    patched[patch_offset:patch_offset + len(ORIGINAL_BYTES)] = jump + b"\x90" * (len(ORIGINAL_BYTES) - len(jump))
    checksum_offset = binary.OPTIONAL_HEADER.get_field_absolute_offset("CheckSum")
    struct.pack_into("<I", patched, checksum_offset, 0)
    result = pefile.PE(data=bytes(patched), fast_load=True)
    struct.pack_into("<I", patched, checksum_offset, result.generate_checksum())
    result = pefile.PE(data=bytes(patched), fast_load=True)
    if result.get_data(section_address, len(code)) != code:
        raise ValueError("Prepared section does not map to the expected instructions")
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoded = list(decoder.disasm(code, section_address))
    if sum(instruction.size for instruction in decoded) != len(code):
        raise ValueError("Incomplete trampoline disassembly")
    if [instruction.mnemonic for instruction in decoded] != ["cmp", "jne", "mov", "cmp", "jne", "jmp"]:
        raise ValueError("Unexpected trampoline instruction sequence")
    allowed = [(header_offset, header_offset + 40), (patch_offset, patch_offset + len(ORIGINAL_BYTES))]
    for structure, field, size in ((binary.FILE_HEADER, "NumberOfSections", 2),
                                   (binary.OPTIONAL_HEADER, "SizeOfImage", 4),
                                   (binary.OPTIONAL_HEADER, "SizeOfCode", 4),
                                   (binary.OPTIONAL_HEADER, "CheckSum", 4)):
        offset = structure.get_field_absolute_offset(field)
        allowed.append((offset, offset + size))
    for index, (previous, current) in enumerate(zip(original, patched)):
        if previous != current and not any(start <= index < end for start, end in allowed):
            raise ValueError("Unexpected original DLL byte changed")
    report = {"sourceSha256": SOURCE_SHA256, "preparedSha256": hashlib.sha256(patched).hexdigest(),
              "resourceId": FLASHBACK_RESOURCE_ID, "nativeSkillValue": 2, "displayedSkillStars": 3,
              "patchRva": PATCH_RVA, "sectionRva": section_address,
              "branchTarget": branch_target, "returnTarget": PATCH_RVA + len(ORIGINAL_BYTES),
              "weakFootUnchanged": True, "requiresGameValidation": True,
              "signatureNote": "Modified image is not signed by EA; original certificate bytes retained. No signature or protection bypass is performed."}
    return bytes(patched), report


def main():
    source = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    if destination == source.parent or source.parent in destination.parents:
        raise ValueError("Prepare outside the game directory; this tool never installs")
    if destination.exists():
        raise FileExistsError("Use a new isolated preparation directory")
    patched, report = build(source.read_bytes())
    destination.mkdir(parents=True)
    (destination / source.name).write_bytes(patched)
    (destination / "preparation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
