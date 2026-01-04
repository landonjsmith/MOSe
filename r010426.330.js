// MOSe, release version: 010426.330
// Copyright 2026 Landon J. Smith - All Rights Reserved.
class mose {
  constructor(ramSizeKB = 64) {
    const ramSizeMap = {
      4: 0x1000,   
      8: 0x2000,   
      16: 0x4000,  
      32: 0x8000,  
      48: 0xC000,
      64: 0x10000
    };
    this.ram = new Uint8Array(ramSizeMap[ramSizeKB] || 0x10000);
    this.ramSize = ramSizeKB;
    
    // CPU Registers
    this.A = 0;
    this.X = 0;
    this.Y = 0;
    this.PC = 0;
    this.S = 0xFF;
    
    // Status Flags
    this.C = 0;  // Carry
    this.Z = 0;  // Zero
    this.I = 0;  // Interrupt Disable
    this.D = 0;  // Decimal Mode
    this.B = 0;  // Break
    this.V = 0;  // Overflow
    this.N = 0;  // Negative
    
    // Cycle counting
    this.opcode = 0;
    this.cycles = 0;
    this.totalCycles = 0;
    
    // Configuration
    this.emulateIndirectJMPBug = true; // Usual JMP hardware bug...Common with original 6502 chips.
    
    // Instruction setup
    this.instructionMap = {};
    this.cycleTable = {};
    this.setupInstructions();
    this.setupCycleTiming();
    
    // Break flag for interrupt handling
    this._breakFlag = false;
    
    // NMI support
    this._nmiPending = false;
    this._nmiEdge = false;  // Edge detection for NMI
  }

  // Memory Access
  read(addr) {
    addr &= 0xFFFF;
    if (addr < this.ram.length) {
      return this.ram[addr] & 0xFF;
    }
    return 0xFF;
  }

  write(addr, val) {
    addr &= 0xFFFF;
    val &= 0xFF;
    if (addr < this.ram.length) {
      this.ram[addr] = val;
    }
  }

  // Stack Operations
  push(v) {
    this.write(0x100 + (this.S & 0xFF), v & 0xFF);
    this.S = (this.S - 1) & 0xFF;
  }

  pop() {
    this.S = (this.S + 1) & 0xFF;
    return this.read(0x100 + (this.S & 0xFF));
  }

  // Status Register
  setZN(v) {
    v &= 0xFF;
    this.Z = (v === 0) ? 1 : 0;
    this.N = (v & 0x80) ? 1 : 0;
  }

  getStatus() {
    return (this.N << 7) | (this.V << 6) | (1 << 5) | (this.B << 4) |
           (this.D << 3) | (this.I << 2) | (this.Z << 1) | this.C;
  }

  setStatus(v) {
    this.N = (v >> 7) & 1;
    this.V = (v >> 6) & 1;
    this.B = (v >> 4) & 1;
    this.D = (v >> 3) & 1;
    this.I = (v >> 2) & 1;
    this.Z = (v >> 1) & 1;
    this.C = v & 1;
  }

  // BCD conversion helpers
  bcdToBinary(bcd) {
    return ((bcd >> 4) * 10) + (bcd & 0x0F);
  }

  binaryToBCD(bin) {
    return ((Math.floor(bin / 10) << 4) | (bin % 10)) & 0xFF;
  }

  // Page Cross Detection
  checkPageCross(a, b) {
    return (a & 0xFF00) !== (b & 0xFF00);
  }

  // NMI Control
  // Trigger NMI - uses edge detection (falling edge)
  triggerNMI() {
    this._nmiEdge = true;
  }

  // Check and handle NMI
  handleNMI() {
    if (this._nmiEdge) {
      this._nmiEdge = false;
      this._nmiPending = false;
      
      // Push PC and status onto stack
      this.push((this.PC >> 8) & 0xFF);
      this.push(this.PC & 0xFF);
      // Push status with B flag clear (bit 4 = 0 for interrupts)
      this.push(this.getStatus() & ~0x10);
      
      // Set interrupt disable flag
      this.I = 1;
      
      // Load NMI vector from $FFFA-$FFFB
      const lo = this.read(0xFFFA);
      const hi = this.read(0xFFFB);
      this.PC = ((hi << 8) | lo) & 0xFFFF;
      
      // NMI takes 7 cycles
      this.cycles = 7;
      this.totalCycles += 7;
      
      return true;
    }
    return false;
  }

  // Unified Addressing Mode Resolution
  // Returns: { address, value, pageCrossed, isWrite }
  
  imm() {
    const addr = this.PC++;
    return { address: addr, value: this.read(addr), pageCrossed: false, isWrite: false };
  }

  zp() {
    const zpAddr = this.read(this.PC++);
    return { address: zpAddr, value: this.read(zpAddr), pageCrossed: false, isWrite: false };
  }

  zpx() {
    const zpAddr = (this.read(this.PC++) + this.X) & 0xFF;
    return { address: zpAddr, value: this.read(zpAddr), pageCrossed: false, isWrite: false };
  }

  zpy() {
    const zpAddr = (this.read(this.PC++) + this.Y) & 0xFF;
    return { address: zpAddr, value: this.read(zpAddr), pageCrossed: false, isWrite: false };
  }

  abs() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    const addr = ((hi << 8) | lo) & 0xFFFF;
    return { address: addr, value: this.read(addr), pageCrossed: false, isWrite: false };
  }

  absx() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    const base = ((hi << 8) | lo) & 0xFFFF;
    const addr = (base + this.X) & 0xFFFF;
    const pageCrossed = this.checkPageCross(base, addr);
    return { address: addr, value: this.read(addr), pageCrossed, isWrite: false };
  }

  absy() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    const base = ((hi << 8) | lo) & 0xFFFF;
    const addr = (base + this.Y) & 0xFFFF;
    const pageCrossed = this.checkPageCross(base, addr);
    return { address: addr, value: this.read(addr), pageCrossed, isWrite: false };
  }

  ind() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    const ptr = ((hi << 8) | lo) & 0xFFFF;
    
    let low, high;
    if (this.emulateIndirectJMPBug && (ptr & 0xFF) === 0xFF) {
      // 6502 bug: JMP ($xxFF) fetches from $xxFF and $xx00 instead of $xxFF and $xx00+1
      low = this.read(ptr);
      high = this.read(ptr & 0xFF00);
    } else {
      low = this.read(ptr);
      high = this.read((ptr + 1) & 0xFFFF);
    }
    
    const addr = ((high << 8) | low) & 0xFFFF;
    return { address: addr, value: 0, pageCrossed: false, isWrite: false };
  }

  indx() {
    const zp = (this.read(this.PC++) + this.X) & 0xFF;
    const lo = this.read(zp & 0xFF);
    const hi = this.read((zp + 1) & 0xFF);
    const addr = ((hi << 8) | lo) & 0xFFFF;
    return { address: addr, value: this.read(addr), pageCrossed: false, isWrite: false };
  }

  indy() {
    const zp = this.read(this.PC++) & 0xFF;
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xFF);
    const base = ((hi << 8) | lo) & 0xFFFF;
    const addr = (base + this.Y) & 0xFFFF;
    const pageCrossed = this.checkPageCross(base, addr);
    return { address: addr, value: this.read(addr), pageCrossed, isWrite: false };
  }

  rel() {
    const off = this.read(this.PC++);
    const target = (off & 0x80) ? (this.PC + off - 0x100) & 0xFFFF : (this.PC + off) & 0xFFFF;
    return { address: target, value: 0, pageCrossed: false, isWrite: false };
  }

  // Load/Store Instructions
  LDA(v) { this.A = v & 0xFF; this.setZN(this.A); }
  STA(a) { this.write(a, this.A); }
  LDX(v) { this.X = v & 0xFF; this.setZN(this.X); }
  STX(a) { this.write(a, this.X); }
  LDY(v) { this.Y = v & 0xFF; this.setZN(this.Y); }
  STY(a) { this.write(a, this.Y); }

  // Transfer Instructions
  TAX() { this.X = this.A & 0xFF; this.setZN(this.X); }
  TXA() { this.A = this.X & 0xFF; this.setZN(this.A); }
  TAY() { this.Y = this.A & 0xFF; this.setZN(this.Y); }
  TYA() { this.A = this.Y & 0xFF; this.setZN(this.A); }
  TSX() { this.X = this.S & 0xFF; this.setZN(this.X); }
  TXS() { this.S = this.X & 0xFF; }

  // Stack Instructions
  PHA() { this.push(this.A); }
  PLA() { this.A = this.pop(); this.setZN(this.A); }
  PHP() { this.push(this.getStatus() | 0x10); }
  PLP() { this.setStatus(this.pop()); }

  // Increment/Decrement
  INX() { this.X = (this.X + 1) & 0xFF; this.setZN(this.X); }
  DEX() { this.X = (this.X - 1) & 0xFF; this.setZN(this.X); }
  INY() { this.Y = (this.Y + 1) & 0xFF; this.setZN(this.Y); }
  DEY() { this.Y = (this.Y - 1) & 0xFF; this.setZN(this.Y); }

  INC(a) {
    let v = (this.read(a) + 1) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  DEC(a) {
    let v = (this.read(a) - 1) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  // Flag Instructions
  CLC() { this.C = 0; }
  SEC() { this.C = 1; }
  CLI() { this.I = 0; }
  SEI() { this.I = 1; }
  CLV() { this.V = 0; }
  CLD() { this.D = 0; }
  SED() { this.D = 1; }

  // No Operation
  NOP() {}

  // Jump/Branch Instructions
  JMP(a) { this.PC = a & 0xFFFF; }

  JSR(a) {
    const ret = (this.PC - 1) & 0xFFFF;
    this.push((ret >> 8) & 0xFF);
    this.push(ret & 0xFF);
    this.PC = a & 0xFFFF;
  }

  RTS() {
    const lo = this.pop();
    const hi = this.pop();
    this.PC = (((hi << 8) | lo) + 1) & 0xFFFF;
  }

  BRK() {
    this.B = 1;
    this.PC = (this.PC + 1) & 0xFFFF;
    this.push((this.PC >> 8) & 0xFF);
    this.push(this.PC & 0xFF);
    this.push(this.getStatus() | 0x10);
    this.I = 1;
    const lo = this.read(0xFFFE);
    const hi = this.read(0xFFFF);
    this.PC = ((hi << 8) | lo) & 0xFFFF;
  }

  RTI() {
    this.setStatus(this.pop());
    const lo = this.pop();
    const hi = this.pop();
    this.PC = ((hi << 8) | lo) & 0xFFFF;
  }

  // Branch Instructions (fixed cycle counting)
  BCC(target) {
    if (this.C === 0) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1; 
      if (pageCrossed) {
        this.cycles += 1; 
      }
      this.PC = target;
    }
  }

  BCS(target) {
    if (this.C === 1) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BEQ(target) {
    if (this.Z === 1) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BNE(target) {
    if (this.Z === 0) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BPL(target) {
    if (this.N === 0) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BMI(target) {
    if (this.N === 1) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BVC(target) {
    if (this.V === 0) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  BVS(target) {
    if (this.V === 1) {
      const pageCrossed = this.checkPageCross(this.PC, target);
      this.cycles += 1;
      if (pageCrossed) {
        this.cycles += 1;
      }
      this.PC = target;
    }
  }

  // Arithmetic Instructions with Decimal Mode support
  ADC(v) {
    v &= 0xFF;
    
    if (this.D === 0) {
      // Binary mode
      const sum = this.A + v + (this.C ? 1 : 0);
      this.C = sum > 0xFF ? 1 : 0;
      this.V = ((~(this.A ^ v) & (this.A ^ sum)) & 0x80) ? 1 : 0;
      this.A = sum & 0xFF;
      this.setZN(this.A);
    } else {
      // Decimal mode (BCD)
      let al = (this.A & 0x0F) + (v & 0x0F) + (this.C ? 1 : 0);
      let ah = (this.A >> 4) + (v >> 4);
      
      if (al > 9) {
        al += 6;
        ah++;
      }
      
      // Z and N flags based on binary result
      const binaryResult = this.A + v + (this.C ? 1 : 0);
      this.setZN(binaryResult & 0xFF);
      
      // V flag calculation (based on binary addition)
      this.V = ((~(this.A ^ v) & (this.A ^ binaryResult)) & 0x80) ? 1 : 0;
      
      if (ah > 9) {
        ah += 6;
      }
      
      this.C = ah > 15 ? 1 : 0;
      this.A = ((ah << 4) | (al & 0x0F)) & 0xFF;
    }
  }

  SBC(v) {
    v &= 0xFF;
    
    if (this.D === 0) {
      // Binary mode
      const inv = (v ^ 0xFF) & 0xFF;
      this.ADC(inv);
    } else {
      // Decimal mode (BCD)
      let al = (this.A & 0x0F) - (v & 0x0F) - (this.C ? 0 : 1);
      let ah = (this.A >> 4) - (v >> 4);
      
      if (al < 0) {
        al -= 6;
        ah--;
      }
      
      // Z and N flags based on binary result
      const binaryResult = this.A - v - (this.C ? 0 : 1);
      this.setZN(binaryResult & 0xFF);
      
      // V flag calculation
      this.V = (((this.A ^ v) & (this.A ^ binaryResult)) & 0x80) ? 1 : 0;
      
      if (ah < 0) {
        ah -= 6;
      }
      
      this.C = ah >= 0 ? 1 : 0;
      this.A = ((ah << 4) | (al & 0x0F)) & 0xFF;
    }
  }

  // Logic Instructions
  AND(v) { this.A &= (v & 0xFF); this.setZN(this.A); }
  ORA(v) { this.A |= (v & 0xFF); this.setZN(this.A); }
  EOR(v) { this.A ^= (v & 0xFF); this.setZN(this.A); }

  // Compare Instructions
  CMP(v) {
    const r = (this.A - (v & 0xFF)) & 0x1FF;
    this.C = (r < 0x100) ? 1 : 0;
    this.setZN(r & 0xFF);
  }

  CPX(v) {
    const r = (this.X - (v & 0xFF)) & 0x1FF;
    this.C = (r < 0x100) ? 1 : 0;
    this.setZN(r & 0xFF);
  }

  CPY(v) {
    const r = (this.Y - (v & 0xFF)) & 0x1FF;
    this.C = (r < 0x100) ? 1 : 0;
    this.setZN(r & 0xFF);
  }

  BIT(v) {
    v &= 0xFF;
    this.Z = (this.A & v) ? 0 : 1;
    this.N = (v & 0x80) ? 1 : 0;
    this.V = (v & 0x40) ? 1 : 0;
  }

  // Shift/Rotate Instructions
  ASL_A() {
    this.C = (this.A >> 7) & 1;
    this.A = (this.A << 1) & 0xFF;
    this.setZN(this.A);
  }

  ASL(a) {
    let v = this.read(a);
    this.C = (v >> 7) & 1;
    v = (v << 1) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  LSR_A() {
    this.C = this.A & 1;
    this.A = (this.A >>> 1) & 0xFF;
    this.setZN(this.A);
  }

  LSR(a) {
    let v = this.read(a);
    this.C = v & 1;
    v = (v >>> 1) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  ROL_A() {
    const oldC = this.C;
    this.C = (this.A >> 7) & 1;
    this.A = ((this.A << 1) | oldC) & 0xFF;
    this.setZN(this.A);
  }

  ROL(a) {
    let v = this.read(a);
    const oldC = this.C;
    this.C = (v >> 7) & 1;
    v = ((v << 1) | oldC) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  ROR_A() {
    const oldC = this.C;
    this.C = this.A & 1;
    this.A = ((this.A >>> 1) | (oldC << 7)) & 0xFF;
    this.setZN(this.A);
  }

  ROR(a) {
    let v = this.read(a);
    const oldC = this.C;
    this.C = v & 1;
    v = ((v >>> 1) | (oldC << 7)) & 0xFF;
    this.write(a, v);
    this.setZN(v);
  }

  // Illegal/Undocumented Instructions
  LAX(v) { this.A = this.X = v & 0xFF; this.setZN(this.A); }
  SAX(a) { this.write(a, this.A & this.X); }
  DCP(a) { this.DEC(a); this.CMP(this.read(a)); }
  ISC(a) { this.INC(a); this.SBC(this.read(a)); }
  SLO(a) { this.ASL(a); this.ORA(this.read(a)); }
  RLA(a) { this.ROL(a); this.AND(this.read(a)); }
  SRE(a) { this.LSR(a); this.EOR(this.read(a)); }
  RRA(a) { this.ROR(a); this.ADC(this.read(a)); }
  ANC(v) { this.AND(v); this.C = this.N; }
  ALR(v) { this.AND(v); this.LSR_A(); }
  ARR(v) { this.AND(v); this.ROR_A(); this.C = (this.A >> 6) & 1; this.V = ((this.A >> 6) ^ (this.A >> 5)) & 1; }
  XAA(v) { this.A = this.X & (v & 0xFF); this.setZN(this.A); }
  AXS(v) { const temp = (this.A & this.X) & 0xFF; const result = temp - (v & 0xFF); this.X = result & 0xFF; this.C = (result >= 0) ? 1 : 0; this.setZN(this.X); }
  SHY(a) { const val = this.Y & (((a >>> 8) + 1) & 0xFF); this.write(a, val); }
  SHX(a) { const val = this.X & (((a >>> 8) + 1) & 0xFF); this.write(a, val); }

  // Cycle Timing Table
  setupCycleTiming() {
    this.cycleTable = [
      7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
      6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
      6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
      6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
      2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
      2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
      2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
      2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7
    ];
  }

  // Instruction Map Setup
  setupInstructions() {
    // Initialize all opcodes as KIL 
    for (let i = 0; i < 256; i++) {
      this.instructionMap[i] = () => {
        console.warn(`KIL instruction: ${i.toString(16).padStart(2, '0')}`);
        this.PC = (this.PC - 1) & 0xFFFF;
      };
    }

    // Basic Instructions
    this.instructionMap[0x00] = () => this.BRK();
    this.instructionMap[0xEA] = () => this.NOP();

    // LDA 
    this.instructionMap[0xA9] = () => { const m = this.imm(); this.LDA(m.value); };
    this.instructionMap[0xA5] = () => { const m = this.zp(); this.LDA(m.value); };
    this.instructionMap[0xB5] = () => { const m = this.zpx(); this.LDA(m.value); };
    this.instructionMap[0xAD] = () => { const m = this.abs(); this.LDA(m.value); };
    this.instructionMap[0xBD] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.LDA(m.value); };
    this.instructionMap[0xB9] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.LDA(m.value); };
    this.instructionMap[0xA1] = () => { const m = this.indx(); this.LDA(m.value); };
    this.instructionMap[0xB1] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.LDA(m.value); };

    // STA 
    this.instructionMap[0x85] = () => { const m = this.zp(); this.STA(m.address); };
    this.instructionMap[0x95] = () => { const m = this.zpx(); this.STA(m.address); };
    this.instructionMap[0x8D] = () => { const m = this.abs(); this.STA(m.address); };
    this.instructionMap[0x9D] = () => { const m = this.absx(); this.STA(m.address); };
    this.instructionMap[0x99] = () => { const m = this.absy(); this.STA(m.address); };
    this.instructionMap[0x81] = () => { const m = this.indx(); this.STA(m.address); };
    this.instructionMap[0x91] = () => { const m = this.indy(); this.STA(m.address); };

    // LDX
    this.instructionMap[0xA2] = () => { const m = this.imm(); this.LDX(m.value); };
    this.instructionMap[0xA6] = () => { const m = this.zp(); this.LDX(m.value); };
    this.instructionMap[0xB6] = () => { const m = this.zpy(); this.LDX(m.value); };
    this.instructionMap[0xAE] = () => { const m = this.abs(); this.LDX(m.value); };
    this.instructionMap[0xBE] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.LDX(m.value); };

    // LDY
    this.instructionMap[0xA0] = () => { const m = this.imm(); this.LDY(m.value); };
    this.instructionMap[0xA4] = () => { const m = this.zp(); this.LDY(m.value); };
    this.instructionMap[0xB4] = () => { const m = this.zpx(); this.LDY(m.value); };
    this.instructionMap[0xAC] = () => { const m = this.abs(); this.LDY(m.value); };
    this.instructionMap[0xBC] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.LDY(m.value); };

    // STX
    this.instructionMap[0x86] = () => { const m = this.zp(); this.STX(m.address); };
    this.instructionMap[0x96] = () => { const m = this.zpy(); this.STX(m.address); };
    this.instructionMap[0x8E] = () => { const m = this.abs(); this.STX(m.address); };

    // STY
    this.instructionMap[0x84] = () => { const m = this.zp(); this.STY(m.address); };
    this.instructionMap[0x94] = () => { const m = this.zpx(); this.STY(m.address); };
    this.instructionMap[0x8C] = () => { const m = this.abs(); this.STY(m.address); };

    // Transfer Instructions
    this.instructionMap[0xAA] = () => this.TAX();
    this.instructionMap[0x8A] = () => this.TXA();
    this.instructionMap[0xA8] = () => this.TAY();
    this.instructionMap[0x98] = () => this.TYA();
    this.instructionMap[0xBA] = () => this.TSX();
    this.instructionMap[0x9A] = () => this.TXS();

    // Stack Instructions
    this.instructionMap[0x48] = () => this.PHA();
    this.instructionMap[0x68] = () => this.PLA();
    this.instructionMap[0x08] = () => this.PHP();
    this.instructionMap[0x28] = () => this.PLP();

    // Increment/Decrement
    this.instructionMap[0xE8] = () => this.INX();
    this.instructionMap[0xCA] = () => this.DEX();
    this.instructionMap[0xC8] = () => this.INY();
    this.instructionMap[0x88] = () => this.DEY();
    this.instructionMap[0xE6] = () => { const m = this.zp(); this.INC(m.address); };
    this.instructionMap[0xF6] = () => { const m = this.zpx(); this.INC(m.address); };
    this.instructionMap[0xEE] = () => { const m = this.abs(); this.INC(m.address); };
    this.instructionMap[0xFE] = () => { const m = this.absx(); this.INC(m.address); };
    this.instructionMap[0xC6] = () => { const m = this.zp(); this.DEC(m.address); };
    this.instructionMap[0xD6] = () => { const m = this.zpx(); this.DEC(m.address); };
    this.instructionMap[0xCE] = () => { const m = this.abs(); this.DEC(m.address); };
    this.instructionMap[0xDE] = () => { const m = this.absx(); this.DEC(m.address); };

    // ADC
    this.instructionMap[0x69] = () => { const m = this.imm(); this.ADC(m.value); };
    this.instructionMap[0x65] = () => { const m = this.zp(); this.ADC(m.value); };
    this.instructionMap[0x75] = () => { const m = this.zpx(); this.ADC(m.value); };
    this.instructionMap[0x6D] = () => { const m = this.abs(); this.ADC(m.value); };
    this.instructionMap[0x7D] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.ADC(m.value); };
    this.instructionMap[0x79] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.ADC(m.value); };
    this.instructionMap[0x61] = () => { const m = this.indx(); this.ADC(m.value); };
    this.instructionMap[0x71] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.ADC(m.value); };

    // SBC
    this.instructionMap[0xE9] = () => { const m = this.imm(); this.SBC(m.value); };
    this.instructionMap[0xE5] = () => { const m = this.zp(); this.SBC(m.value); };
    this.instructionMap[0xF5] = () => { const m = this.zpx(); this.SBC(m.value); };
    this.instructionMap[0xED] = () => { const m = this.abs(); this.SBC(m.value); };
    this.instructionMap[0xFD] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.SBC(m.value); };
    this.instructionMap[0xF9] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.SBC(m.value); };
    this.instructionMap[0xE1] = () => { const m = this.indx(); this.SBC(m.value); };
    this.instructionMap[0xF1] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.SBC(m.value); };

    // AND
    this.instructionMap[0x29] = () => { const m = this.imm(); this.AND(m.value); };
    this.instructionMap[0x25] = () => { const m = this.zp(); this.AND(m.value); };
    this.instructionMap[0x35] = () => { const m = this.zpx(); this.AND(m.value); };
    this.instructionMap[0x2D] = () => { const m = this.abs(); this.AND(m.value); };
    this.instructionMap[0x3D] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.AND(m.value); };
    this.instructionMap[0x39] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.AND(m.value); };
    this.instructionMap[0x21] = () => { const m = this.indx(); this.AND(m.value); };
    this.instructionMap[0x31] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.AND(m.value); };

    // ORA
    this.instructionMap[0x09] = () => { const m = this.imm(); this.ORA(m.value); };
    this.instructionMap[0x05] = () => { const m = this.zp(); this.ORA(m.value); };
    this.instructionMap[0x15] = () => { const m = this.zpx(); this.ORA(m.value); };
    this.instructionMap[0x0D] = () => { const m = this.abs(); this.ORA(m.value); };
    this.instructionMap[0x1D] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.ORA(m.value); };
    this.instructionMap[0x19] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.ORA(m.value); };
    this.instructionMap[0x01] = () => { const m = this.indx(); this.ORA(m.value); };
    this.instructionMap[0x11] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.ORA(m.value); };

    // EOR
    this.instructionMap[0x49] = () => { const m = this.imm(); this.EOR(m.value); };
    this.instructionMap[0x45] = () => { const m = this.zp(); this.EOR(m.value); };
    this.instructionMap[0x55] = () => { const m = this.zpx(); this.EOR(m.value); };
    this.instructionMap[0x4D] = () => { const m = this.abs(); this.EOR(m.value); };
    this.instructionMap[0x5D] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.EOR(m.value); };
    this.instructionMap[0x59] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.EOR(m.value); };
    this.instructionMap[0x41] = () => { const m = this.indx(); this.EOR(m.value); };
    this.instructionMap[0x51] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.EOR(m.value); };

    // CMP
    this.instructionMap[0xC9] = () => { const m = this.imm(); this.CMP(m.value); };
    this.instructionMap[0xC5] = () => { const m = this.zp(); this.CMP(m.value); };
    this.instructionMap[0xD5] = () => { const m = this.zpx(); this.CMP(m.value); };
    this.instructionMap[0xCD] = () => { const m = this.abs(); this.CMP(m.value); };
    this.instructionMap[0xDD] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.CMP(m.value); };
    this.instructionMap[0xD9] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.CMP(m.value); };
    this.instructionMap[0xC1] = () => { const m = this.indx(); this.CMP(m.value); };
    this.instructionMap[0xD1] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.CMP(m.value); };

    // CPX
    this.instructionMap[0xE0] = () => { const m = this.imm(); this.CPX(m.value); };
    this.instructionMap[0xE4] = () => { const m = this.zp(); this.CPX(m.value); };
    this.instructionMap[0xEC] = () => { const m = this.abs(); this.CPX(m.value); };

    // CPY
    this.instructionMap[0xC0] = () => { const m = this.imm(); this.CPY(m.value); };
    this.instructionMap[0xC4] = () => { const m = this.zp(); this.CPY(m.value); };
    this.instructionMap[0xCC] = () => { const m = this.abs(); this.CPY(m.value); };

    // BIT
    this.instructionMap[0x24] = () => { const m = this.zp(); this.BIT(m.value); };
    this.instructionMap[0x2C] = () => { const m = this.abs(); this.BIT(m.value); };

    // ASL
    this.instructionMap[0x0A] = () => this.ASL_A();
    this.instructionMap[0x06] = () => { const m = this.zp(); this.ASL(m.address); };
    this.instructionMap[0x16] = () => { const m = this.zpx(); this.ASL(m.address); };
    this.instructionMap[0x0E] = () => { const m = this.abs(); this.ASL(m.address); };
    this.instructionMap[0x1E] = () => { const m = this.absx(); this.ASL(m.address); };

    // LSR
    this.instructionMap[0x4A] = () => this.LSR_A();
    this.instructionMap[0x46] = () => { const m = this.zp(); this.LSR(m.address); };
    this.instructionMap[0x56] = () => { const m = this.zpx(); this.LSR(m.address); };
    this.instructionMap[0x4E] = () => { const m = this.abs(); this.LSR(m.address); };
    this.instructionMap[0x5E] = () => { const m = this.absx(); this.LSR(m.address); };

    // ROL
    this.instructionMap[0x2A] = () => this.ROL_A();
    this.instructionMap[0x26] = () => { const m = this.zp(); this.ROL(m.address); };
    this.instructionMap[0x36] = () => { const m = this.zpx(); this.ROL(m.address); };
    this.instructionMap[0x2E] = () => { const m = this.abs(); this.ROL(m.address); };
    this.instructionMap[0x3E] = () => { const m = this.absx(); this.ROL(m.address); };

    // ROR
    this.instructionMap[0x6A] = () => this.ROR_A();
    this.instructionMap[0x66] = () => { const m = this.zp(); this.ROR(m.address); };
    this.instructionMap[0x76] = () => { const m = this.zpx(); this.ROR(m.address); };
    this.instructionMap[0x6E] = () => { const m = this.abs(); this.ROR(m.address); };
    this.instructionMap[0x7E] = () => { const m = this.absx(); this.ROR(m.address); };

    // Branch Instructions
    this.instructionMap[0x90] = () => { const m = this.rel(); this.BCC(m.address); };
    this.instructionMap[0xB0] = () => { const m = this.rel(); this.BCS(m.address); };
    this.instructionMap[0xF0] = () => { const m = this.rel(); this.BEQ(m.address); };
    this.instructionMap[0x30] = () => { const m = this.rel(); this.BMI(m.address); };
    this.instructionMap[0xD0] = () => { const m = this.rel(); this.BNE(m.address); };
    this.instructionMap[0x10] = () => { const m = this.rel(); this.BPL(m.address); };
    this.instructionMap[0x50] = () => { const m = this.rel(); this.BVC(m.address); };
    this.instructionMap[0x70] = () => { const m = this.rel(); this.BVS(m.address); };

    // Jump/Subroutine Instructions
    this.instructionMap[0x4C] = () => { const m = this.abs(); this.JMP(m.address); };
    this.instructionMap[0x6C] = () => { const m = this.ind(); this.JMP(m.address); };
    this.instructionMap[0x20] = () => { const m = this.abs(); this.JSR(m.address); };
    this.instructionMap[0x60] = () => this.RTS();
    this.instructionMap[0x40] = () => this.RTI();

    // Flag Instructions
    this.instructionMap[0x18] = () => this.CLC();
    this.instructionMap[0x38] = () => this.SEC();
    this.instructionMap[0x58] = () => this.CLI();
    this.instructionMap[0x78] = () => this.SEI();
    this.instructionMap[0xB8] = () => this.CLV();
    this.instructionMap[0xD8] = () => this.CLD();
    this.instructionMap[0xF8] = () => this.SED();

    // Illegal/Undocumented Instructions
    this.instructionMap[0xA7] = () => { const m = this.zp(); this.LAX(m.value); };
    this.instructionMap[0xB7] = () => { const m = this.zpy(); this.LAX(m.value); };
    this.instructionMap[0xAF] = () => { const m = this.abs(); this.LAX(m.value); };
    this.instructionMap[0xBF] = () => { const m = this.absy(); if (m.pageCrossed) this.cycles++; this.LAX(m.value); };
    this.instructionMap[0xA3] = () => { const m = this.indx(); this.LAX(m.value); };
    this.instructionMap[0xB3] = () => { const m = this.indy(); if (m.pageCrossed) this.cycles++; this.LAX(m.value); };

    this.instructionMap[0x87] = () => { const m = this.zp(); this.SAX(m.address); };
    this.instructionMap[0x97] = () => { const m = this.zpy(); this.SAX(m.address); };
    this.instructionMap[0x8F] = () => { const m = this.abs(); this.SAX(m.address); };
    this.instructionMap[0x83] = () => { const m = this.indx(); this.SAX(m.address); };

    this.instructionMap[0xC7] = () => { const m = this.zp(); this.DCP(m.address); };
    this.instructionMap[0xD7] = () => { const m = this.zpx(); this.DCP(m.address); };
    this.instructionMap[0xCF] = () => { const m = this.abs(); this.DCP(m.address); };
    this.instructionMap[0xDF] = () => { const m = this.absx(); this.DCP(m.address); };
    this.instructionMap[0xDB] = () => { const m = this.absy(); this.DCP(m.address); };
    this.instructionMap[0xC3] = () => { const m = this.indx(); this.DCP(m.address); };
    this.instructionMap[0xD3] = () => { const m = this.indy(); this.DCP(m.address); };

    this.instructionMap[0xE7] = () => { const m = this.zp(); this.ISC(m.address); };
    this.instructionMap[0xF7] = () => { const m = this.zpx(); this.ISC(m.address); };
    this.instructionMap[0xEF] = () => { const m = this.abs(); this.ISC(m.address); };
    this.instructionMap[0xFF] = () => { const m = this.absx(); this.ISC(m.address); };
    this.instructionMap[0xFB] = () => { const m = this.absy(); this.ISC(m.address); };
    this.instructionMap[0xE3] = () => { const m = this.indx(); this.ISC(m.address); };
    this.instructionMap[0xF3] = () => { const m = this.indy(); this.ISC(m.address); };

    this.instructionMap[0x07] = () => { const m = this.zp(); this.SLO(m.address); };
    this.instructionMap[0x17] = () => { const m = this.zpx(); this.SLO(m.address); };
    this.instructionMap[0x0F] = () => { const m = this.abs(); this.SLO(m.address); };
    this.instructionMap[0x1F] = () => { const m = this.absx(); this.SLO(m.address); };
    this.instructionMap[0x1B] = () => { const m = this.absy(); this.SLO(m.address); };
    this.instructionMap[0x03] = () => { const m = this.indx(); this.SLO(m.address); };
    this.instructionMap[0x13] = () => { const m = this.indy(); this.SLO(m.address); };

    this.instructionMap[0x27] = () => { const m = this.zp(); this.RLA(m.address); };
    this.instructionMap[0x37] = () => { const m = this.zpx(); this.RLA(m.address); };
    this.instructionMap[0x2F] = () => { const m = this.abs(); this.RLA(m.address); };
    this.instructionMap[0x3F] = () => { const m = this.absx(); this.RLA(m.address); };
    this.instructionMap[0x3B] = () => { const m = this.absy(); this.RLA(m.address); };
    this.instructionMap[0x23] = () => { const m = this.indx(); this.RLA(m.address); };
    this.instructionMap[0x33] = () => { const m = this.indy(); this.RLA(m.address); };

    this.instructionMap[0x47] = () => { const m = this.zp(); this.SRE(m.address); };
    this.instructionMap[0x57] = () => { const m = this.zpx(); this.SRE(m.address); };
    this.instructionMap[0x4F] = () => { const m = this.abs(); this.SRE(m.address); };
    this.instructionMap[0x5F] = () => { const m = this.absx(); this.SRE(m.address); };
    this.instructionMap[0x5B] = () => { const m = this.absy(); this.SRE(m.address); };
    this.instructionMap[0x43] = () => { const m = this.indx(); this.SRE(m.address); };
    this.instructionMap[0x53] = () => { const m = this.indy(); this.SRE(m.address); };

    this.instructionMap[0x67] = () => { const m = this.zp(); this.RRA(m.address); };
    this.instructionMap[0x77] = () => { const m = this.zpx(); this.RRA(m.address); };
    this.instructionMap[0x6F] = () => { const m = this.abs(); this.RRA(m.address); };
    this.instructionMap[0x7F] = () => { const m = this.absx(); this.RRA(m.address); };
    this.instructionMap[0x7B] = () => { const m = this.absy(); this.RRA(m.address); };
    this.instructionMap[0x63] = () => { const m = this.indx(); this.RRA(m.address); };
    this.instructionMap[0x73] = () => { const m = this.indy(); this.RRA(m.address); };

    this.instructionMap[0x0B] = () => { const m = this.imm(); this.ANC(m.value); };
    this.instructionMap[0x2B] = () => { const m = this.imm(); this.ANC(m.value); };
    this.instructionMap[0x4B] = () => { const m = this.imm(); this.ALR(m.value); };
    this.instructionMap[0x6B] = () => { const m = this.imm(); this.ARR(m.value); };
    this.instructionMap[0x8B] = () => { const m = this.imm(); this.XAA(m.value); };
    this.instructionMap[0xCB] = () => { const m = this.imm(); this.AXS(m.value); };
    this.instructionMap[0x9C] = () => { const m = this.absx(); this.SHY(m.address); };
    this.instructionMap[0x9E] = () => { const m = this.absy(); this.SHX(m.address); };

    // NOP variants
    this.instructionMap[0x1A] = () => this.NOP();
    this.instructionMap[0x3A] = () => this.NOP();
    this.instructionMap[0x5A] = () => this.NOP();
    this.instructionMap[0x7A] = () => this.NOP();
    this.instructionMap[0xDA] = () => this.NOP();
    this.instructionMap[0xFA] = () => this.NOP();
    this.instructionMap[0x04] = () => { this.zp(); this.NOP(); };
    this.instructionMap[0x44] = () => { this.zp(); this.NOP(); };
    this.instructionMap[0x64] = () => { this.zp(); this.NOP(); };
    this.instructionMap[0x14] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0x34] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0x54] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0x74] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0xD4] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0xF4] = () => { this.zpx(); this.NOP(); };
    this.instructionMap[0x0C] = () => { this.abs(); this.NOP(); };
    this.instructionMap[0x1C] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0x3C] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0x5C] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0x7C] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0xDC] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0xFC] = () => { const m = this.absx(); if (m.pageCrossed) this.cycles++; this.NOP(); };
    this.instructionMap[0x80] = () => { this.imm(); this.NOP(); };
    this.instructionMap[0x82] = () => { this.imm(); this.NOP(); };
    this.instructionMap[0x89] = () => { this.imm(); this.NOP(); };
    this.instructionMap[0xC2] = () => { this.imm(); this.NOP(); };
    this.instructionMap[0xE2] = () => { this.imm(); this.NOP(); };
  }

  // Execute one instruction
  step() {
    if (this._breakFlag) {
      this._breakFlag = false;
      return this.cycles;
    }

    // Check for NMI before fetching the next instruction
    if (this.handleNMI()) {
      return this.cycles;
    }

    this.opcode = this.read(this.PC++);
    this.cycles = this.cycleTable[this.opcode] || 2;

    const instr = this.instructionMap[this.opcode & 0xFF];
    if (instr) {
      instr();
    } else {
      console.warn(`Unimplemented: ${this.opcode.toString(16)}`);
    }

    this.totalCycles += this.cycles;
    return this.cycles;
  }

  // Run for a specific number of cycles
  runCycles(target) {
    const start = this.totalCycles;
    const goal = start + target;
    while (this.totalCycles < goal) {
      this.step();
    }
    return this.totalCycles - start;
  }

  // Reset CPU
  reset() {
    this.A = this.X = this.Y = 0;
    this.S = 0xFF;
    this.C = this.Z = this.I = this.D = this.B = this.V = this.N = 0;
    this.I = 1;
    this.B = 0;
    const lo = this.read(0xFFFC);
    const hi = this.read(0xFFFD);
    this.PC = ((hi << 8) | lo) & 0xFFFF;
    this.cycles = 7;
    this.totalCycles += 7;
    this._breakFlag = false;
    this._nmiPending = false;
    this._nmiEdge = false;
  }

  // Trigger break
  triggerBreak() {
    this._breakFlag = true;
  }

  // Run Klaus2m5's 6502 functional test
  // Load the test ROM at address 0x0000 and set PC to 0x0400
  // The test runs indefinitely in a loop at 0x3469 when successful.
  runFunctionalTest(romData) {
    // Load ROM
    for (let i = 0; i < romData.length && i < this.ram.length; i++) {
      this.ram[i] = romData[i];
    }
    
    // Set PC to test start
    this.PC = 0x0400;
    this.S = 0xFF;
    
    const maxCycles = 100000000; 
    let lastPC = -1;
    let stuckCount = 0;
    
    console.log('Starting Klaus2m5 functional test...');
    
    while (this.totalCycles < maxCycles) {
      const pc = this.PC;
      this.step();
      
      // Success trap at 0x3469
      if (pc === 0x3469 && this.PC === 0x3469) {
        console.log('Test PASSED - Success trap reached at 0x3469');
        console.log(`Total cycles: ${this.totalCycles}`);
        return { passed: true, pc: 0x3469, cycles: this.totalCycles };
      }
      
      // Detect stuck/infinite loop (not at success address)
      if (pc === lastPC && pc !== 0x3469) {
        stuckCount++;
        if (stuckCount > 5) {
          console.log(`Test FAILED - Stuck at PC: 0x${pc.toString(16).padStart(4, '0')}`);
          console.log(`Registers: A=${this.A.toString(16)} X=${this.X.toString(16)} Y=${this.Y.toString(16)}`);
          console.log(`Flags: N=${this.N} V=${this.V} D=${this.D} I=${this.I} Z=${this.Z} C=${this.C}`);
          return { passed: false, pc, cycles: this.totalCycles, reason: 'stuck' };
        }
      } else {
        stuckCount = 0;
      }
      lastPC = pc;
    }
    
    console.log('Test FAILED - Timeout');
    return { passed: false, pc: this.PC, cycles: this.totalCycles, reason: 'timeout' };
  }

  // Run a test comparing against expected state
  // Useful for individual instruction tests
  runTest(test) {
    // Set initial state
    this.A = test.initial.A || 0;
    this.X = test.initial.X || 0;
    this.Y = test.initial.Y || 0;
    this.S = test.initial.S || 0xFF;
    this.PC = test.initial.PC || 0;
    this.setStatus(test.initial.P || 0);
    
    // Load memory
    if (test.initial.ram) {
      test.initial.ram.forEach(([addr, val]) => {
        this.write(addr, val);
      });
    }
    
    // Run for specified cycles or steps
    const targetCycles = test.cycles || 1;
    this.step();
    
    // Check final state
    const errors = [];
    
    if (test.final.A !== undefined && this.A !== test.final.A) {
      errors.push(`A: expected ${test.final.A}, got ${this.A}`);
    }
    if (test.final.X !== undefined && this.X !== test.final.X) {
      errors.push(`X: expected ${test.final.X}, got ${this.X}`);
    }
    if (test.final.Y !== undefined && this.Y !== test.final.Y) {
      errors.push(`Y: expected ${test.final.Y}, got ${this.Y}`);
    }
    if (test.final.S !== undefined && this.S !== test.final.S) {
      errors.push(`S: expected ${test.final.S}, got ${this.S}`);
    }
    if (test.final.PC !== undefined && this.PC !== test.final.PC) {
      errors.push(`PC: expected ${test.final.PC}, got ${this.PC}`);
    }
    if (test.final.P !== undefined && this.getStatus() !== test.final.P) {
      errors.push(`P: expected ${test.final.P.toString(16)}, got ${this.getStatus().toString(16)}`);
    }
    
    // Check memory
    if (test.final.ram) {
      test.final.ram.forEach(([addr, expected]) => {
        const actual = this.read(addr);
        if (actual !== expected) {
          errors.push(`RAM[0x${addr.toString(16)}]: expected ${expected}, got ${actual}`);
        }
      });
    }
    
    // Check cycles
    if (test.cycles && this.cycles !== test.cycles) {
      errors.push(`Cycles: expected ${test.cycles}, got ${this.cycles}`);
    }
    
    return {
      passed: errors.length === 0,
      errors,
      name: test.name || 'unnamed test'
    };
  }

  // Tests for accuracy checking.
  runTestSuite(tests) {
    console.log(`Running ${tests.length} tests...`);
    const results = tests.map(test => {
      const result = this.runTest(test);
      if (result.passed) {
        console.log(`PASSED: ${result.name}`);
      } else {
        console.log(`FAILED: ${result.name}`);
        result.errors.forEach(err => console.log(`  ${err}`));
      }
      return result;
    });
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return { passed, failed, results };
  }
}

// Export for use in Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = mose;
}ß