# MOSe
**Pronounced "Mossy"**

A cycle-accurate 6502 CPU emulator written in JavaScript.
Originally developed as the CPU core for the [HoneyCrisp Emulator](https://github.com/landonjsmith/honeycrisp), 
MOSe is now available for general-purpose use in building 6502-based system emulators.

## Quick Start
```javascript
// Create a CPU instance
const cpu = new mose();

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
const cpu = new mose(memorySize = 0x10000)
```
Creates a new 6502 CPU instance with the specified memory size (default 64KB).

### Methods
#### Execution
- `step()` - Execute one instruction, returns cycles taken
- `runCycles(target)` - Execute instructions for approximately `target` cycles
- `reset()` - Reset CPU to initial state, load PC from reset vector ($FFFC-$FFFD)

#### Memory Access
- `read(addr)` - Read byte from memory address
- `write(addr, value)` - Write byte to memory address

#### Stack Operations
- `push(value)` - Push byte onto stack
- `pop()` - Pop byte from stack

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

## Example: Running a Simple Program
```javascript
const cpu = new mose();

// Load a program that adds two numbers
const program = [
  0xA9, 0x05,           // LDA #$05
  0x69, 0x03,           // ADC #$03
  0x8D, 0x00, 0x02,     // STA $0200
  0x00                  // BRK
];

// Load program at $0600
program.forEach((byte, i) => cpu.write(0x0600 + i, byte));

// Set reset vector to point to our program
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

## Building System Emulators
MOSe is designed as an emulation core. 
It handles CPU operations, but you'll need to add system-specific hardware to create a complete emulator.

**Examples of systems you can build:**
- **Apple-1** - Proven with [HoneyCrisp Emulator](https://github.com/landonjsmith/honeycrisp) (add 6820 PIA, terminal I/O)
- **NES** - Add PPU, APU, and memory mappers
- **Apple II** - Add video, keyboard, and disk I/O
- **Commodore 64** - Add VIC-II, SID, and CIA chips
- **Atari 2600** - Add TIA and RIOT chips

The clean separation between CPU and peripherals makes integration straightforward.

## Installation
```bash
# Clone the repository
git clone https://github.com/landonjsmith/MOSe.git

# Or download the latest release
# https://github.com/landonjsmith/MOSe/releases
```

## Compatibility
- **Browsers** - Works in all modern browsers (ES6+)
- **Node.js** - Compatible with Node.js 12+
- **Bundlers** - Works with Webpack, Rollup, Vite, etc.

## License
MIT License - See [LICENSE](LICENSE) file for details

## Acknowledgments
- The 6502 was designed by Chuck Peddle and the MOS Technology team.
- Originally developed for the HoneyCrisp Emulator project. (Shoutout to Steve Wozniak!)
- Thanks to the retro computing community for keeping the 6502 alive!
