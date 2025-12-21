class MOSE {
  constructor(memorySize = 0x10000) {
    // Memory
    this.memory = new Uint8Array(memorySize);
    
    // Registers
    this.A = 0;      // Accumulator
    this.X = 0;      // X register
    this.Y = 0;      // Y register
    this.PC = 0;     // Program Counter
    this.S = 0xFF;   // Stack Pointer
    
    // Status flags
    this.C = 0;      // Carry
    this.Z = 0;      // Zero
    this.I = 0;      // Interrupt Disable
    this.D = 0;      // Decimal Mode
    this.B = 0;      // Break
    this.V = 0;      // Overflow
    this.N = 0;      // Negative
    
    // Execution state
    this.opcode = 0;
    this.cycles = 0;
    this.totalCycles = 0;
    this.pageCrossed = false;
    
    // Setup instruction handlers
    this.instructionMap = {};
    this.cycleTable = {};
    this.setupInstructions();
    this.setupCycleTiming();
  }

  // Memory access
  read(addr) {
    return this.memory[addr & 0xFFFF] & 0xFF;
  }

  write(addr, val) {
    this.memory[addr & 0xFFFF] = val & 0xFF;
  }

  // Stack operations
  push(v) {
    this.write(0x100 + (this.S & 0xFF), v & 0xFF);
    this.S = (this.S - 1) & 0xFF;
  }

  pop() {
    this.S = (this.S + 1) & 0xFF;
    return this.read(0x100 + (this.S & 0xFF));
  }

  // Status register
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

  // Addressing modes
  checkPageCross(a, b) {
    return (a & 0xFF00) !== (b & 0xFF00);
  }

  imm() { return this.read(this.PC++); }
  
  zp() { return this.read(this.read(this.PC++)); }
  
  zpx() { return this.read((this.read(this.PC++) + this.X) & 0xFF); }
  
  zpy() { return this.read((this.read(this.PC++) + this.Y) & 0xFF); }
  
  abs() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    return this.read((hi << 8) | lo);
  }
  
  absAddr() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    return ((hi << 8) | lo) & 0xFFFF;
  }
  
  absXAddr() {
    const base = this.absAddr();
    const addr = (base + this.X) & 0xFFFF;
    this.pageCrossed = this.checkPageCross(base, addr);
    return addr;
  }
  
  absYAddr() {
    const base = this.absAddr();
    const addr = (base + this.Y) & 0xFFFF;
    this.pageCrossed = this.checkPageCross(base, addr);
    return addr;
  }
  
  ind() {
    const lo = this.read(this.PC++);
    const hi = this.read(this.PC++);
    const ptr = ((hi << 8) | lo) & 0xFFFF;
    const low = this.read(ptr);
    const high = this.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF));
    return ((high << 8) | low) & 0xFFFF;
  }
  
  indx() {
    const zp = (this.read(this.PC++) + this.X) & 0xFF;
    const lo = this.read(zp & 0xFF);
    const hi = this.read((zp + 1) & 0xFF);
    return ((hi << 8) | lo) & 0xFFFF;
  }
  
  indy() {
    const zp = this.read(this.PC++) & 0xFF;
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xFF);
    const base = ((hi << 8) | lo) & 0xFFFF;
    const addr = (base + this.Y) & 0xFFFF;
    this.pageCrossed = this.checkPageCross(base, addr);
    return addr;
  }

  rel() {
    const off = this.read(this.PC++);
    const target = (off & 0x80) ? 
      (this.PC + off - 0x100) & 0xFFFF : 
      (this.PC + off) & 0xFFFF;
    this.pageCrossed = this.checkPageCross(this.PC, target);
    return target;
  }

  // Instructions - Load/Store
  LDA(v) { this.A = v & 0xFF; this.setZN(this.A); }
  LDX(v) { this.X = v & 0xFF; this.setZN(this.X); }
  LDY(v) { this.Y = v & 0xFF; this.setZN(this.Y); }
  STA(a) { this.write(a, this.A); }
  STX(a) { this.write(a, this.X); }
  STY(a) { this.write(a, this.Y); }

  // Transfers
  TAX() { this.X = this.A & 0xFF; this.setZN(this.X); }
  TXA() { this.A = this.X & 0xFF; this.setZN(this.A); }
  TAY() { this.Y = this.A & 0xFF; this.setZN(this.Y); }
  TYA() { this.A = this.Y & 0xFF; this.setZN(this.A); }
  TSX() { this.X = this.S & 0xFF; this.setZN(this.X); }
  TXS() { this.S = this.X & 0xFF; }

  // Stack
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

  // Flags
  CLC() { this.C = 0; }
  SEC() { this.C = 1; }
  CLI() { this.I = 0; }
  SEI() { this.I = 1; }
  CLV() { this.V = 0; }
  CLD() { this.D = 0; }
  SED() { this.D = 1; }
  
  NOP() {}

  // Control Flow
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

  // Arithmetic
  ADC(v) {
    v &= 0xFF;
    const sum = this.A + v + (this.C ? 1 : 0);
    this.C = sum > 0xFF ? 1 : 0;
    this.V = ((~(this.A ^ v) & (this.A ^ sum)) & 0x80) ? 1 : 0;
    this.A = sum & 0xFF;
    this.setZN(this.A);
  }
  
  SBC(v) {
    v &= 0xFF;
    const inv = (v ^ 0xFF) & 0xFF;
    this.ADC(inv);
  }

  // Logic
  AND(v) { this.A &= (v & 0xFF); this.setZN(this.A); }
  ORA(v) { this.A |= (v & 0xFF); this.setZN(this.A); }
  EOR(v) { this.A ^= (v & 0xFF); this.setZN(this.A); }

  // Comparison
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

  // Shifts and Rotates
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

  // Branches
  BCC(addr) {
    if (this.C === 0) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BCS(addr) {
    if (this.C === 1) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BEQ(addr) {
    if (this.Z === 1) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BNE(addr) {
    if (this.Z === 0) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BPL(addr) {
    if (this.N === 0) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BMI(addr) {
    if (this.N === 1) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BVC(addr) {
    if (this.V === 0) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }
  
  BVS(addr) {
    if (this.V === 1) {
      this.PC = addr;
      this.cycles += 1;
      if (this.pageCrossed) this.cycles += 1;
    }
  }

  // Undocumented opcodes (commonly used)
  LAX(v) { this.A = this.X = v & 0xFF; this.setZN(this.A); }
  SAX(a) { this.write(a, this.A & this.X); }
  DCP(a) { this.DEC(a); this.CMP(this.read(a)); }
  ISC(a) { this.INC(a); this.SBC(this.read(a)); }
  SLO(a) { this.ASL(a); this.ORA(this.read(a)); }
  RLA(a) { this.ROL(a); this.AND(this.read(a)); }
  SRE(a) { this.LSR(a); this.EOR(this.read(a)); }
  RRA(a) { this.ROR(a); this.ADC(this.read(a)); }

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

  setupInstructions() {
    // Initialize all opcodes as illegal/KIL
    for (let i = 0; i < 256; i++) {
      this.instructionMap[i] = () => {
        console.warn(`Illegal opcode: 0x${i.toString(16).padStart(2, '0')}`);
        this.PC = (this.PC - 1) & 0xFFFF;
      };
    }

    // Legal opcodes
    this.instructionMap[0x00] = () => this.BRK();
    this.instructionMap[0xEA] = () => this.NOP();
    
    // LDA
    this.instructionMap[0xA9] = () => this.LDA(this.imm());
    this.instructionMap[0xA5] = () => this.LDA(this.zp());
    this.instructionMap[0xB5] = () => this.LDA(this.zpx());
    this.instructionMap[0xAD] = () => this.LDA(this.abs());
    this.instructionMap[0xBD] = () => this.LDA(this.read(this.absXAddr()));
    this.instructionMap[0xB9] = () => this.LDA(this.read(this.absYAddr()));
    this.instructionMap[0xA1] = () => this.LDA(this.read(this.indx()));
    this.instructionMap[0xB1] = () => this.LDA(this.read(this.indy()));
    
    // STA
    this.instructionMap[0x85] = () => this.STA(this.read(this.PC++) & 0xFF);
    this.instructionMap[0x95] = () => this.STA((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x8D] = () => this.STA(this.absAddr());
    this.instructionMap[0x9D] = () => this.STA(this.absXAddr());
    this.instructionMap[0x99] = () => this.STA(this.absYAddr());
    this.instructionMap[0x81] = () => this.STA(this.indx());
    this.instructionMap[0x91] = () => this.STA(this.indy());
    
    // LDX
    this.instructionMap[0xA2] = () => this.LDX(this.imm());
    this.instructionMap[0xA6] = () => this.LDX(this.zp());
    this.instructionMap[0xB6] = () => this.LDX(this.zpy());
    this.instructionMap[0xAE] = () => this.LDX(this.abs());
    this.instructionMap[0xBE] = () => this.LDX(this.read(this.absYAddr()));
    
    // STX
    this.instructionMap[0x86] = () => this.STX(this.read(this.PC++));
    this.instructionMap[0x96] = () => this.STX((this.read(this.PC++) + this.Y) & 0xFF);
    this.instructionMap[0x8E] = () => this.STX(this.absAddr());
    
    // LDY
    this.instructionMap[0xA0] = () => this.LDY(this.imm());
    this.instructionMap[0xA4] = () => this.LDY(this.zp());
    this.instructionMap[0xB4] = () => this.LDY(this.zpx());
    this.instructionMap[0xAC] = () => this.LDY(this.abs());
    this.instructionMap[0xBC] = () => this.LDY(this.read(this.absXAddr()));
    
    // STY
    this.instructionMap[0x84] = () => this.STY(this.read(this.PC++));
    this.instructionMap[0x94] = () => this.STY((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x8C] = () => this.STY(this.absAddr());
    
    // Transfers
    this.instructionMap[0xAA] = () => this.TAX();
    this.instructionMap[0x8A] = () => this.TXA();
    this.instructionMap[0xA8] = () => this.TAY();
    this.instructionMap[0x98] = () => this.TYA();
    this.instructionMap[0xBA] = () => this.TSX();
    this.instructionMap[0x9A] = () => this.TXS();
    
    // Stack
    this.instructionMap[0x48] = () => this.PHA();
    this.instructionMap[0x68] = () => this.PLA();
    this.instructionMap[0x08] = () => this.PHP();
    this.instructionMap[0x28] = () => this.PLP();
    
    // Inc/Dec
    this.instructionMap[0xE8] = () => this.INX();
    this.instructionMap[0xCA] = () => this.DEX();
    this.instructionMap[0xC8] = () => this.INY();
    this.instructionMap[0x88] = () => this.DEY();
    this.instructionMap[0xE6] = () => this.INC(this.read(this.PC++));
    this.instructionMap[0xF6] = () => this.INC((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0xEE] = () => this.INC(this.absAddr());
    this.instructionMap[0xFE] = () => this.INC(this.absXAddr());
    this.instructionMap[0xC6] = () => this.DEC(this.read(this.PC++));
    this.instructionMap[0xD6] = () => this.DEC((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0xCE] = () => this.DEC(this.absAddr());
    this.instructionMap[0xDE] = () => this.DEC(this.absXAddr());
    
    // Arithmetic
    this.instructionMap[0x69] = () => this.ADC(this.imm());
    this.instructionMap[0x65] = () => this.ADC(this.zp());
    this.instructionMap[0x75] = () => this.ADC(this.zpx());
    this.instructionMap[0x6D] = () => this.ADC(this.abs());
    this.instructionMap[0x7D] = () => this.ADC(this.read(this.absXAddr()));
    this.instructionMap[0x79] = () => this.ADC(this.read(this.absYAddr()));
    this.instructionMap[0x61] = () => this.ADC(this.read(this.indx()));
    this.instructionMap[0x71] = () => this.ADC(this.read(this.indy()));
    
    this.instructionMap[0xE9] = () => this.SBC(this.imm());
    this.instructionMap[0xE5] = () => this.SBC(this.zp());
    this.instructionMap[0xF5] = () => this.SBC(this.zpx());
    this.instructionMap[0xED] = () => this.SBC(this.abs());
    this.instructionMap[0xFD] = () => this.SBC(this.read(this.absXAddr()));
    this.instructionMap[0xF9] = () => this.SBC(this.read(this.absYAddr()));
    this.instructionMap[0xE1] = () => this.SBC(this.read(this.indx()));
    this.instructionMap[0xF1] = () => this.SBC(this.read(this.indy()));
    
    // Logic
    this.instructionMap[0x29] = () => this.AND(this.imm());
    this.instructionMap[0x25] = () => this.AND(this.zp());
    this.instructionMap[0x35] = () => this.AND(this.zpx());
    this.instructionMap[0x2D] = () => this.AND(this.abs());
    this.instructionMap[0x3D] = () => this.AND(this.read(this.absXAddr()));
    this.instructionMap[0x39] = () => this.AND(this.read(this.absYAddr()));
    this.instructionMap[0x21] = () => this.AND(this.read(this.indx()));
    this.instructionMap[0x31] = () => this.AND(this.read(this.indy()));
    
    this.instructionMap[0x09] = () => this.ORA(this.imm());
    this.instructionMap[0x05] = () => this.ORA(this.zp());
    this.instructionMap[0x15] = () => this.ORA(this.zpx());
    this.instructionMap[0x0D] = () => this.ORA(this.abs());
    this.instructionMap[0x1D] = () => this.ORA(this.read(this.absXAddr()));
    this.instructionMap[0x19] = () => this.ORA(this.read(this.absYAddr()));
    this.instructionMap[0x01] = () => this.ORA(this.read(this.indx()));
    this.instructionMap[0x11] = () => this.ORA(this.read(this.indy()));
    
    this.instructionMap[0x49] = () => this.EOR(this.imm());
    this.instructionMap[0x45] = () => this.EOR(this.zp());
    this.instructionMap[0x55] = () => this.EOR(this.zpx());
    this.instructionMap[0x4D] = () => this.EOR(this.abs());
    this.instructionMap[0x5D] = () => this.EOR(this.read(this.absXAddr()));
    this.instructionMap[0x59] = () => this.EOR(this.read(this.absYAddr()));
    this.instructionMap[0x41] = () => this.EOR(this.read(this.indx()));
    this.instructionMap[0x51] = () => this.EOR(this.read(this.indy()));
    
    // Comparison
    this.instructionMap[0xC9] = () => this.CMP(this.imm());
    this.instructionMap[0xC5] = () => this.CMP(this.zp());
    this.instructionMap[0xD5] = () => this.CMP(this.zpx());
    this.instructionMap[0xCD] = () => this.CMP(this.abs());
    this.instructionMap[0xDD] = () => this.CMP(this.read(this.absXAddr()));
    this.instructionMap[0xD9] = () => this.CMP(this.read(this.absYAddr()));
    this.instructionMap[0xC1] = () => this.CMP(this.read(this.indx()));
    this.instructionMap[0xD1] = () => this.CMP(this.read(this.indy()));
    
    this.instructionMap[0xE0] = () => this.CPX(this.imm());
    this.instructionMap[0xE4] = () => this.CPX(this.zp());
    this.instructionMap[0xEC] = () => this.CPX(this.abs());
    
    this.instructionMap[0xC0] = () => this.CPY(this.imm());
    this.instructionMap[0xC4] = () => this.CPY(this.zp());
    this.instructionMap[0xCC] = () => this.CPY(this.abs());
    
    this.instructionMap[0x24] = () => this.BIT(this.zp());
    this.instructionMap[0x2C] = () => this.BIT(this.abs());
    
    // Shifts
    this.instructionMap[0x0A] = () => this.ASL_A();
    this.instructionMap[0x06] = () => this.ASL(this.read(this.PC++));
    this.instructionMap[0x16] = () => this.ASL((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x0E] = () => this.ASL(this.absAddr());
    this.instructionMap[0x1E] = () => this.ASL(this.absXAddr());
    
    this.instructionMap[0x4A] = () => this.LSR_A();
    this.instructionMap[0x46] = () => this.LSR(this.read(this.PC++));
    this.instructionMap[0x56] = () => this.LSR((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x4E] = () => this.LSR(this.absAddr());
    this.instructionMap[0x5E] = () => this.LSR(this.absXAddr());
    
    this.instructionMap[0x2A] = () => this.ROL_A();
    this.instructionMap[0x26] = () => this.ROL(this.read(this.PC++));
    this.instructionMap[0x36] = () => this.ROL((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x2E] = () => this.ROL(this.absAddr());
    this.instructionMap[0x3E] = () => this.ROL(this.absXAddr());
    
    this.instructionMap[0x6A] = () => this.ROR_A();
    this.instructionMap[0x66] = () => this.ROR(this.read(this.PC++));
    this.instructionMap[0x76] = () => this.ROR((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x6E] = () => this.ROR(this.absAddr());
    this.instructionMap[0x7E] = () => this.ROR(this.absXAddr());
    
    // Branches
    this.instructionMap[0x90] = () => this.BCC(this.rel());
    this.instructionMap[0xB0] = () => this.BCS(this.rel());
    this.instructionMap[0xF0] = () => this.BEQ(this.rel());
    this.instructionMap[0x30] = () => this.BMI(this.rel());
    this.instructionMap[0xD0] = () => this.BNE(this.rel());
    this.instructionMap[0x10] = () => this.BPL(this.rel());
    this.instructionMap[0x50] = () => this.BVC(this.rel());
    this.instructionMap[0x70] = () => this.BVS(this.rel());
    
    // Jumps
    this.instructionMap[0x4C] = () => this.JMP(this.absAddr());
    this.instructionMap[0x6C] = () => this.JMP(this.ind());
    this.instructionMap[0x20] = () => this.JSR(this.absAddr());
    this.instructionMap[0x60] = () => this.RTS();
    this.instructionMap[0x40] = () => this.RTI();
    
    // Flags
    this.instructionMap[0x18] = () => this.CLC();
    this.instructionMap[0x38] = () => this.SEC();
    this.instructionMap[0x58] = () => this.CLI();
    this.instructionMap[0x78] = () => this.SEI();
    this.instructionMap[0xB8] = () => this.CLV();
    this.instructionMap[0xD8] = () => this.CLD();
    this.instructionMap[0xF8] = () => this.SED();
    
    // Undocumented opcodes
    this.instructionMap[0xA7] = () => this.LAX(this.zp());
    this.instructionMap[0xB7] = () => this.LAX(this.zpy());
    this.instructionMap[0xAF] = () => this.LAX(this.abs());
    this.instructionMap[0xBF] = () => this.LAX(this.read(this.absYAddr()));
    this.instructionMap[0xA3] = () => this.LAX(this.read(this.indx()));
    this.instructionMap[0xB3] = () => this.LAX(this.read(this.indy()));
    
    this.instructionMap[0x87] = () => this.SAX(this.read(this.PC++));
    this.instructionMap[0x97] = () => this.SAX((this.read(this.PC++) + this.Y) & 0xFF);
    this.instructionMap[0x8F] = () => this.SAX(this.absAddr());
    this.instructionMap[0x83] = () => this.SAX(this.indx());
    
    this.instructionMap[0xC7] = () => this.DCP(this.read(this.PC++));
    this.instructionMap[0xD7] = () => this.DCP((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0xCF] = () => this.DCP(this.absAddr());
    this.instructionMap[0xDF] = () => this.DCP(this.absXAddr());
    this.instructionMap[0xDB] = () => this.DCP(this.absYAddr());
    this.instructionMap[0xC3] = () => this.DCP(this.indx());
    this.instructionMap[0xD3] = () => this.DCP(this.indy());
    
    this.instructionMap[0xE7] = () => this.ISC(this.read(this.PC++));
    this.instructionMap[0xF7] = () => this.ISC((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0xEF] = () => this.ISC(this.absAddr());
    this.instructionMap[0xFF] = () => this.ISC(this.absXAddr());
    this.instructionMap[0xFB] = () => this.ISC(this.absYAddr());
    this.instructionMap[0xE3] = () => this.ISC(this.indx());
    this.instructionMap[0xF3] = () => this.ISC(this.indy());
    
    this.instructionMap[0x07] = () => this.SLO(this.read(this.PC++));
    this.instructionMap[0x17] = () => this.SLO((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x0F] = () => this.SLO(this.absAddr());
    this.instructionMap[0x1F] = () => this.SLO(this.absXAddr());
    this.instructionMap[0x1B] = () => this.SLO(this.absYAddr());
    this.instructionMap[0x03] = () => this.SLO(this.indx());
    this.instructionMap[0x13] = () => this.SLO(this.indy());
    
    this.instructionMap[0x27] = () => this.RLA(this.read(this.PC++));
    this.instructionMap[0x37] = () => this.RLA((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x2F] = () => this.RLA(this.absAddr());
    this.instructionMap[0x3F] = () => this.RLA(this.absXAddr());
    this.instructionMap[0x3B] = () => this.RLA(this.absYAddr());
    this.instructionMap[0x23] = () => this.RLA(this.indx());
    this.instructionMap[0x33] = () => this.RLA(this.indy());
    
    this.instructionMap[0x47] = () => this.SRE(this.read(this.PC++));
    this.instructionMap[0x57] = () => this.SRE((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x4F] = () => this.SRE(this.absAddr());
    this.instructionMap[0x5F] = () => this.SRE(this.absXAddr());
    this.instructionMap[0x5B] = () => this.SRE(this.absYAddr());
    this.instructionMap[0x43] = () => this.SRE(this.indx());
    this.instructionMap[0x53] = () => this.SRE(this.indy());
    
    this.instructionMap[0x67] = () => this.RRA(this.read(this.PC++));
    this.instructionMap[0x77] = () => this.RRA((this.read(this.PC++) + this.X) & 0xFF);
    this.instructionMap[0x6F] = () => this.RRA(this.absAddr());
    this.instructionMap[0x7F] = () => this.RRA(this.absXAddr());
    this.instructionMap[0x7B] = () => this.RRA(this.absYAddr());
    this.instructionMap[0x63] = () => this.RRA(this.indx());
    this.instructionMap[0x73] = () => this.RRA(this.indy());
    
    // NOP variants
    this.instructionMap[0x1A] = () => this.NOP();
    this.instructionMap[0x3A] = () => this.NOP();
    this.instructionMap[0x5A] = () => this.NOP();
    this.instructionMap[0x7A] = () => this.NOP();
    this.instructionMap[0xDA] = () => this.NOP();
    this.instructionMap[0xFA] = () => this.NOP();
    this.instructionMap[0x04] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x44] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x64] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x14] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x34] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x54] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x74] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0xD4] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0xF4] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x0C] = () => { this.PC += 2; this.NOP(); };
    this.instructionMap[0x1C] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0x3C] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0x5C] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0x7C] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0xDC] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0xFC] = () => { this.absXAddr(); this.NOP(); };
    this.instructionMap[0x80] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x82] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0x89] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0xC2] = () => { this.PC++; this.NOP(); };
    this.instructionMap[0xE2] = () => { this.PC++; this.NOP(); };
  }

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
  }

  step() {
    this.opcode = this.read(this.PC++);
    this.pageCrossed = false;
    this.cycles = this.cycleTable[this.opcode] || 2;
    
    const instr = this.instructionMap[this.opcode & 0xFF];
    if (instr) {
      instr();
    } else {
      console.warn(`Unimplemented opcode: 0x${this.opcode.toString(16)}`);
    }
    
    if (this.pageCrossed && this.needsPageCrossPenalty(this.opcode)) {
      this.cycles += 1;
    }
    
    this.totalCycles += this.cycles;
    return this.cycles;
  }

  needsPageCrossPenalty(op) {
    const opcodes = new Set([
      0x1D, 0x19, 0x39, 0x3D, 0x59, 0x5D, 0x79, 0x7D,
      0xB1, 0xB9, 0xBD, 0xBE, 0xBC,
      0xD1, 0xD9, 0xDD, 0xF1, 0xF9, 0xFD,
      0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC,
      0xBF, 0xB3,
      0x1B, 0x3B, 0x5B, 0x7B, 0xDB, 0xFB,
      0xDF, 0xFF, 0x9C, 0x9E
    ]);
    return opcodes.has(op);
  }

  runCycles(target) {
    const start = this.totalCycles;
    while ((this.totalCycles - start) < target) {
      this.step();
    }
    return this.totalCycles - start;
  }
}