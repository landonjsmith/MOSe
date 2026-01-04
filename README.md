# MOSe

**Pronounced "Mossy"**

A cycle-accurate 6502 CPU emulator written in JavaScript.

Originally developed as the CPU core for the [HoneyCrisp Emulator](https://github.com/landonjsmith/honeycrisp), 
MOSe is now available for general-purpose use in building 6502-based system emulators.

## Quick Start

```javascript
// Create a CPU instance with 64KB RAM (default)
const cpu = new mose(64);

// Load some code
cpu.write(0x0600, 0xA9); // LDA #$42
cpu.write(0x0601, 0x42);

// Set program counter and execute
cpu.PC = 0x0600;
cpu.step();

console.log(cpu.A); // 0x42
```

## API Reference

### Constructor

```javascript
const cpu = new mose(ramSizeKB = 64)
```

Creates a new 6502 CPU instance with the specified RAM size in kilobytes.

**Supported RAM sizes:** 4, 8, 16, 32, 48, 64 (default: 64KB)

```javascript
const cpu = new mose(16);  // 16KB RAM system
const cpu = new mose(64);  // 64KB RAM system (default)
```

### Methods

#### Execution

- `step()` - Execute one instruction, returns cycles taken
- `runCycles(target)` - Execute instructions for approximately `target` cycles
- `reset()` - Reset CPU to initial state, load PC from reset vector ($FFFC-$FFFD)
- `triggerBreak()` - Set break flag for next instruction cycle
- `triggerNMI()` - Trigger a Non-Maskable Interrupt (processed on next step)

#### Memory Access

- `read(addr)` - Read byte from memory address
- `write(addr, value)` - Write byte to memory address

#### Stack Operations

- `push(value)` - Push byte onto stack
- `pop()` - Pop byte from stack

#### Status Register

- `getStatus()` - Get status register as byte
- `setStatus(value)` - Set status register from byte
- `setZN(value)` - Set Zero and Negative flags based on value

#### Testing & Validation

- `runTest(test)` - Run a single test case, returns result object
- `runTestSuite(tests)` - Run multiple tests, returns summary
- `runFunctionalTest(romData)` - Run Klaus2m5's 6502 functional test ROM

### Registers

Direct access to CPU registers:

- `A` - Accumulator
- `X` - X register
- `Y` - Y register
- `PC` - Program Counter
- `S` - Stack Pointer

### Status Flags

- `C` - Carry flag
- `Z` - Zero flag
- `I` - Interrupt Disable flag
- `D` - Decimal Mode flag
- `B` - Break flag
- `V` - Overflow flag
- `N` - Negative flag

### Execution State

- `cycles` - Cycles taken by last instruction
- `totalCycles` - Total cycles executed since reset
- `opcode` - Last executed opcode
- `ramSize` - Configured RAM size in KB

### Configuration

- `emulateIndirectJMPBug` - Enable/disable 6502 JMP ($xxFF) hardware bug (default: true)

## Example: Running a Simple Program

```javascript
const cpu = new mose(64);

// Load a program that adds two numbers
const program = [
  0xA9, 0x05,           // LDA #$05
  0x69, 0x03,           // ADC #$03
  0x8D, 0x00, 0x02,     // STA $0200
  0x00                  // BRK
];

// Load program at $0600
program.forEach((byte, i) => cpu.write(0x0600 + i, byte));

// Set reset vector to point to the program
cpu.write(0xFFFC, 0x00);
cpu.write(0xFFFD, 0x06);

// Reset and run
cpu.reset();

while (cpu.opcode !== 0x00) {  // Run until BRK
  cpu.step();
}

console.log(`Result: ${cpu.read(0x0200)}`);      // Should print 8
console.log(`Total cycles: ${cpu.totalCycles}`); // Cycle count
```

## Example: Using Decimal Mode

```javascript
const cpu = new mose(64);

// Load a BCD addition program
const program = [
  0xF8,                 // SED       ; Set decimal mode
  0xA9, 0x09,           // LDA #$09  ; Load 9 (BCD)
  0x69, 0x01,           // ADC #$01  ; Add 1 (BCD)
  0x8D, 0x00, 0x02,     // STA $0200 ; Store result
  0xD8,                 // CLD       ; Clear decimal mode
  0x00                  // BRK
];

program.forEach((byte, i) => cpu.write(0x0600 + i, byte));
cpu.write(0xFFFC, 0x00);
cpu.write(0xFFFD, 0x06);

cpu.reset();
while (cpu.opcode !== 0x00) {
  cpu.step();
}

console.log(`BCD Result: ${cpu.read(0x0200).toString(16)}`); // 0x10 (BCD: 10)
```

## Example: Handling NMI

```javascript
const cpu = new mose(64);

// Set up NMI handler
const nmiHandler = [
  0xA9, 0xFF,           // LDA #$FF
  0x8D, 0x00, 0x02,     // STA $0200
  0x40                  // RTI
];

// Load NMI handler at $8000
nmiHandler.forEach((byte, i) => cpu.write(0x8000 + i, byte));

// Set NMI vector
cpu.write(0xFFFA, 0x00);
cpu.write(0xFFFB, 0x80);

// Main program
const program = [
  0xA9, 0x00,           // LDA #$00
  0x8D, 0x00, 0x02,     // STA $0200
  0xEA,                 // NOP
  0xEA,                 // NOP
  0x00                  // BRK
];

program.forEach((byte, i) => cpu.write(0x0600 + i, byte));
cpu.write(0xFFFC, 0x00);
cpu.write(0xFFFD, 0x06);

cpu.reset();
cpu.step(); // Execute LDA
cpu.step(); // Execute STA

// Trigger NMI
cpu.triggerNMI();
cpu.step(); // NMI is processed here

console.log(`Result: ${cpu.read(0x0200)}`); // 0xFF (set by NMI handler)
```

## Building System Emulators

MOSe is designed as an emulation core. 
It handles CPU operations, but you'll need to add system-specific hardware to create a complete emulator.

**Examples of systems you can build:**

- **Apple-1** - Proven with [HoneyCrisp Emulator](https://github.com/landonjsmith/honeycrisp) (add 6820 PIA, terminal I/O)
- **NES** - Add PPU, APU, and memory mappers
- **Apple II** - Add video, keyboard, and disk I/O
- **Commodore 64** - Add VIC-II, SID, and CIA chips
- **Atari 2600** - Add TIA and RIOT chips

### Memory-Mapped I/O Example

```javascript
class MySystem {
  constructor() {
    this.cpu = new mose(64);
    this.ioPort = 0x00;
    
    // Override read/write for memory-mapped I/O
    const originalRead = this.cpu.read.bind(this.cpu);
    const originalWrite = this.cpu.write.bind(this.cpu);
    
    this.cpu.read = (addr) => {
      if (addr === 0xD000) return this.ioPort; // I/O port
      return originalRead(addr);
    };
    
    this.cpu.write = (addr, val) => {
      if (addr === 0xD000) {
        this.ioPort = val;
        console.log(`I/O Port: ${val}`);
        return;
      }
      originalWrite(addr, val);
    };
  }
}
```

## Features

### Complete 6502 Instruction Set

- All 151 official opcodes
- Common undocumented/illegal opcodes (LAX, SAX, DCP, ISC, SLO, RLA, SRE, RRA, etc.)
- All 13 addressing modes

### Accuracy Features

- Cycle-accurate timing with page-cross penalties
- Decimal mode (BCD) arithmetic support
- NMI (Non-Maskable Interrupt) support
- Configurable hardware bug emulation (JMP indirect)
- Proper flag behavior matching hardware

### Testing & Validation

- Built-in test framework
- Compatible with Klaus2m5's functional test suite
- Individual instruction testing support

## Installation

```bash
# Clone the repository
git clone https://github.com/landonjsmith/MOSe.git

# Or download the latest release
# https://github.com/landonjsmith/MOSe/releases
```

## Compatibility

- **Browsers** - Works in all modern browsers (ES6+)
- **Node.js** - Compatible with Node.js 12+ (CommonJS export included)
- **Bundlers** - Works with Webpack, Rollup, Vite, etc.

## Documentation
- [Release Notes](RELEASE_NOTES.md) - Detailed changelog and migration guides

## License

MIT License - See [LICENSE](LICENSE) file for details

## Credits

Developed by Landon J. Smith

Special thanks to Klaus Dormann for the 6502 functional test suite.
