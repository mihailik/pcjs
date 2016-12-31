/**
 * @fileoverview Implements the PCx86 SerialPort component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @copyright © Jeff Parsons 2012-2017
 *
 * This file is part of PCjs, a computer emulation software project at <http://pcjs.org/>.
 *
 * PCjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * PCjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with PCjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every modified copy of this work
 * and to display that copyright notice when the software starts running; see COPYRIGHT in
 * <http://pcjs.org/modules/shared/lib/defines.js>.
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of PCjs
 * for purposes of the GNU General Public License, and the author does not claim any copyright
 * as to their contents.
 */

"use strict";

if (NODE) {
    var str         = require("../../shared/lib/strlib");
    var web         = require("../../shared/lib/weblib");
    var Component   = require("../../shared/lib/component");
    var State       = require("../../shared/lib/state");
    var PCX86       = require("./defines");
    var Messages    = require("./messages");
    var ChipSet     = require("./chipset");
}

/**
 * SerialPort(parmsSerial)
 *
 * The SerialPort component has the following component-specific (parmsSerial) properties:
 *
 *      adapter: 1 (port 0x3F8) or 2 (port 0x2F8); 0 if not defined
 *
 *      binding: name of a control (based on its "binding" attribute) to bind to this port's I/O
 *
 *      tabSize: set to a non-zero number to convert tabs to spaces (applies only to output to
 *      the above binding); default is 0 (no conversion)
 *
 * In the future, we may support 'port' and 'irq' properties that allow the machine to define a
 * non-standard serial port configuration, instead of only our pre-defined 'adapter' configurations.
 *
 * NOTE: Since the XSL file defines 'adapter' as a number, not a string, there's no need to use
 * parseInt(), and as an added benefit, we don't need to worry about whether a hex or decimal format
 * was used.
 *
 * This hard-coded approach mimics the original IBM PC Asynchronous Adapter configuration, which
 * contained a pair of "shunt modules" that allowed the user to select a port address of either
 * 0x3F8 ("Primary") or 0x2F8 ("Secondary").
 *
 * DOS typically names the Primary adapter "COM1" and the Secondary adapter "COM2", but I prefer
 * to stick to adapter numbers, since not all operating systems follow those naming conventions.
 *
 * @constructor
 * @extends Component
 * @param {Object} parmsSerial
 */
function SerialPort(parmsSerial) {

    this.iAdapter = parmsSerial['adapter'];

    switch (this.iAdapter) {
    case 1:
        this.portBase = 0x3F8;
        this.nIRQ = ChipSet.IRQ.COM1;
        break;
    case 2:
        this.portBase = 0x2F8;
        this.nIRQ = ChipSet.IRQ.COM2;
        break;
    default:
        Component.warning("Unrecognized serial adapter #" + this.iAdapter);
        return;
    }
    /**
     * consoleOutput becomes a string that records serial port output if the 'binding' property is set to the
     * reserved name "console".  Nothing is written to the console, however, until a linefeed (0x0A) is output
     * or the string length reaches a threshold (currently, 1024 characters).
     *
     * @type {string|null}
     */
    this.consoleOutput = null;

    /**
     * controlIOBuffer is a DOM element bound to the port (currently used for output only; see transmitByte()).
     *
     * Example: CTTY COM2
     *
     * The CTTY DOS command redirects all CON I/O to the specified serial port (eg, COM2), which it assumes is
     * connected to a serial terminal, and therefore anything it *transmits* via COM2 will be displayed by the
     * terminal.  It further assumes that anything typed on such a terminal is NOT displayed, so as DOS *receives*
     * serial input, DOS *transmits* the appropriate characters back to the terminal via COM2.
     *
     * As a result, controlIOBuffer only needs to be updated by the transmitByte() function.
     *
     * @type {Object}
     */
    this.controlIOBuffer = null;

    /*
     * If controlIOBuffer is being used AND 'tabSize' is set, then we make an attempt to monitor the characters
     * being echoed via transmitByte(), maintain a logical column position, and convert any tabs into the appropriate
     * number of spaces.
     *
     * charBOL, if nonzero, is a character to automatically output at the beginning of every line.  This probably
     * isn't generally useful; I use it internally to preformat serial output.
     */
    this.tabSize = parmsSerial['tabSize'];
    this.charBOL = parmsSerial['charBOL'];
    this.iLogicalCol = 0;

    this.bMSRInit = SerialPort.MSR.CTS | SerialPort.MSR.DSR;
    this.fNullModem = true;

    Component.call(this, "SerialPort", parmsSerial, SerialPort, Messages.SERIAL);

    var sBinding = parmsSerial['binding'];
    if (sBinding == "console") {
        this.consoleOutput = "";
    } else {
        /*
         * NOTE: If sBinding is not the name of a valid Control Panel DOM element, this call does nothing.
         */
        Component.bindExternalControl(this, sBinding, SerialPort.sIOBuffer);
    }

    /*
     * No connection until initConnection() is called.
     */
    this.sDataReceived = "";
    this.connection = this.sendData = this.updateStatus = null;

    /*
     * Export all functions required by initConnection().
     */
    this['exports'] = {
        'connect': this.initConnection,
        'receiveData': this.receiveData,
        'receiveStatus': this.receiveStatus
    };
}

/*
 * class SerialPort
 * property {number} iAdapter
 * property {number} portBase
 * property {number} nIRQ
 * property {Object} controlIOBuffer is a DOM element bound to the port (for rudimentary output; see transmitByte())
 *
 * NOTE: This class declaration started as a way of informing the code inspector of the controlIOBuffer property,
 * which remained undefined until a setBinding() call set it later, but I've since decided that explicitly
 * initializing such properties in the constructor is a better way to go -- even though it's more code -- because
 * JavaScript compilers are supposed to be happier when the underlying object structures aren't constantly changing.
 *
 * Besides, I'm not sure I want to get into documenting every property this way, for this or any/every other class,
 * let alone getting into which ones should be considered private or protected, because PCjs isn't really a library
 * for third-party apps.
 */

Component.subclass(SerialPort);

/*
 * Internal name used for the I/O buffer control, if any, that we bind to the SerialPort.
 *
 * Alternatively, if SerialPort wants to use another component's control (eg, the Panel's
 * "print" control), it can specify the name of that control with the 'binding' property.
 *
 * For that binding to succeed, we also need to know the target component; for now, that's
 * been hard-coded to "Panel", in part because that's one of the few components we can rely
 * upon initializing before we do, but it would be a simple matter to include a component type
 * or ID as part of the 'binding' property as well, if we need more flexibility later.
 */
SerialPort.sIOBuffer = "buffer";

/*
 * 8250 I/O register offsets (add these to a I/O base address to obtain an I/O port address)
 *
 * NOTE: DLL.REG and DLM.REG form a 16-bit divisor into a clock input frequency of 1.8432Mhz.  The following
 * values should be used for the corresponding baud rates.  Rates above 9600 are discouraged by the IBM Tech Ref,
 * but rates as high as 128000 are listed on the NS8250A data sheet.
 *
 *      Divisor     Rate        Percent Error
 *      0x0900      50
 *      0x0600      75
 *      0x0417      110         0.026%
 *      0x0359      134.5       0.058%
 *      0x0300      150
 *      0x0180      300
 *      0x00C0      600
 *      0x0060      1200
 *      0x0040      1800
 *      0x003A      2000        0.69%
 *      0x0030      2400
 *      0x0020      3600
 *      0x0018      4800
 *      0x0010      7200
 *      0x000C      9600
 *      0x0006      19200
 *      0x0003      38400
 *      0x0002      56000       2.86%
 *      0x0001      128000
 */
SerialPort.DLL = {REG: 0};              // Divisor Latch LSB (only when SerialPort.LCR.DLAB is set)
SerialPort.THR = {REG: 0};              // Transmitter Holding Register (write)
SerialPort.DL_DEFAULT       = 0x180;    // we select an arbitrary default Divisor Latch equivalent to 300 baud

/*
 * The divisor is stored in wDL.  If we take the frequency value 1843200 and divide it by wDL*128, we get the
 * maximum number of bytes per second that the SerialPort interface should generate.  For example, if a baud
 * rate of 1200 is being used, the divisor will be 0x60 (96), so we calculate 1843200/(96*128) = 150, which means
 * there should be a 1000ms/150 or 6.667ms delay between bytes delivered.
 *
 * TODO: Enforce that delay.  However, the delay should be converted from real-world milliseconds to the
 * appropriate number of CPU cycles we can pass to setBurstCycles().  This will also require the CPU to call
 * us at the start of each burst, to see if advanceRBR() has more data to deliver.  For now, I'm throttling
 * SerialPort interrupts by passing a hard-coded delay to setIRR().  The setIRR() delay does not ensure any
 * particular baud rate, it simply gives the underlying Interrupt Service Routine (ISR) some breathing room.
 *
 * The Microsoft Windows 1.01 serial mouse driver ISR issues an EOI before it has safely exited, presumably
 * relying on the fact that a 1200 baud serial device would not normally interrupt frequently enough to blow
 * the stack.  However, in PCx86, all you have to do is enable Debugger messages on every serial interrupt
 * and mouse event, eg:
 *
 *      m serial on;m pic on;m mouse on
 *
 * to slow the machine down to the point where serial mouse interrupts overwhelm the ISR.  The Debugger messages
 * display the current stack pointer, which you can watch drop to zero and then wrap around, no doubt trampling
 * lots of code and data along the way.
 *
 * This problem could also occur without being forced by the Debugger; eg, if your physical machine's mouse was
 * configured for a high interrupt rate, and your browser generated mouse events at a comparable rate, then you
 * could blow the simulation's stack.
 */

/*
 * Receiver Buffer Register (RBR.REG, offset 0; eg, 0x3F8 or 0x2F8) on read, Transmitter Holding Register on write
 */
SerialPort.RBR = {REG: 0};              // (read)

/*
 * Interrupt Enable Register (IER.REG, offset 1; eg, 0x3F9 or 0x2F9)
 */
SerialPort.IER = {};
SerialPort.IER.REG          = 1;        // Interrupt Enable Register
SerialPort.IER.RBR_AVAIL    = 0x01;
SerialPort.IER.THR_EMPTY    = 0x02;
SerialPort.IER.LSR_DELTA    = 0x04;
SerialPort.IER.MSR_DELTA    = 0x08;
SerialPort.IER.UNUSED       = 0xF0;     // always zero

SerialPort.DLM = {REG: 1};              // Divisor Latch MSB (only when SerialPort.LCR.DLAB is set)

/*
 * Interrupt ID Register (IIR.REG, offset 2; eg, 0x3FA or 0x2FA)
 *
 * All interrupt conditions cleared by reading the corresponding register (or, in the case of IRR_INT_THR, writing a new value to THR.REG)
 */
SerialPort.IIR = {};
SerialPort.IIR.REG          = 2;        // Interrupt ID Register (read-only)
SerialPort.IIR.NO_INT       = 0x01;
SerialPort.IIR.INT_LSR      = 0x06;     // Line Status (highest priority: Overrun error, Parity error, Framing error, or Break Interrupt)
SerialPort.IIR.INT_RBR      = 0x04;     // Receiver Data Available
SerialPort.IIR.INT_THR      = 0x02;     // Transmitter Holding Register Empty
SerialPort.IIR.INT_MSR      = 0x00;     // Modem Status Register (lowest priority: Clear To Send, Data Set Ready, Ring Indicator, or Data Carrier Detect)
SerialPort.IIR.INT_BITS     = 0x06;
SerialPort.IIR.UNUSED       = 0xF8;     // always zero (the ROM BIOS relies on these bits "floating to 1" when no SerialPort is present)

/*
 * Line Control Register (LCR.REG, offset 3; eg, 0x3FB or 0x2FB)
 */
SerialPort.LCR = {};
SerialPort.LCR.REG          = 3;        // Line Control Register
SerialPort.LCR.DATA_5BITS   = 0x00;
SerialPort.LCR.DATA_6BITS   = 0x01;
SerialPort.LCR.DATA_7BITS   = 0x02;
SerialPort.LCR.DATA_8BITS   = 0x03;
SerialPort.LCR.STOP_BITS    = 0x04;     // clear: 1 stop bit; set: 1.5 stop bits for LCR_DATA_5BITS, 2 stop bits for all other data lengths
SerialPort.LCR.PARITY_BIT   = 0x08;     // if set, a parity bit is inserted/expected between the last data bit and the first stop bit; no parity bit if clear
SerialPort.LCR.PARITY_EVEN  = 0x10;     // if set, even parity is selected (ie, the parity bit insures an even number of set bits); if clear, odd parity
SerialPort.LCR.PARITY_STICK = 0x20;     // if set, parity bit is transmitted inverted; if clear, parity bit is transmitted normally
SerialPort.LCR.BREAK        = 0x40;     // if set, serial output (SOUT) signal is forced to logical 0 for the duration
SerialPort.LCR.DLAB         = 0x80;     // Divisor Latch Access Bit; if set, DLL.REG and DLM.REG can be read or written

/*
 * Modem Control Register (MCR.REG, offset 4; eg, 0x3FC or 0x2FC)
 */
SerialPort.MCR = {};
SerialPort.MCR.REG          = 4;        // Modem Control Register
SerialPort.MCR.DTR          = 0x01;     // when set, DTR goes high, indicating ready to establish link (looped back to DSR in loop-back mode)
SerialPort.MCR.RTS          = 0x02;     // when set, RTS goes high, indicating ready to exchange data (looped back to CTS in loop-back mode)
SerialPort.MCR.OUT1         = 0x04;     // when set, OUT1 goes high (looped back to RI in loop-back mode)
SerialPort.MCR.OUT2         = 0x08;     // when set, OUT2 goes high (looped back to RLSD in loop-back mode)
SerialPort.MCR.LOOPBACK     = 0x10;     // when set, enables loop-back mode
SerialPort.MCR.UNUSED       = 0xE0;     // always zero

/*
 * Line Status Register (LSR.REG, offset 5; eg, 0x3FD or 0x2FD)
 *
 * NOTE: I've seen different specs for the LSR_TSRE.  I'm following the IBM Tech Ref's lead here, but the data sheet I have calls it TEMT
 * instead of TSRE, and claims that it is set whenever BOTH the THR and TSR are empty, and clear whenever EITHER the THR or TSR contain data.
 */
SerialPort.LSR = {};
SerialPort.LSR.REG          = 5;        // Line Status Register
SerialPort.LSR.DR           = 0x01;     // Data Ready (set when new data in RBR.REG; cleared when RBR.REG read)
SerialPort.LSR.OE           = 0x02;     // Overrun Error (set when new data arrives in RBR.REG before previous data read; cleared when LSR.REG read)
SerialPort.LSR.PE           = 0x04;     // Parity Error (set when new data has incorrect parity; cleared when LSR.REG read)
SerialPort.LSR.FE           = 0x08;     // Framing Error (set when new data has invalid stop bit; cleared when LSR.REG read)
SerialPort.LSR.BI           = 0x10;     // Break Interrupt (set when new data exceeded normal transmission time; cleared LSR.REG when read)
SerialPort.LSR.THRE         = 0x20;     // Transmitter Holding Register Empty (set when UART ready to accept new data; cleared when THR.REG written)
SerialPort.LSR.TSRE         = 0x40;     // Transmitter Shift Register Empty (set when the TSR is empty; cleared when the THR is transferred to the TSR)
SerialPort.LSR.UNUSED       = 0x80;     // always zero

/*
 * Modem Status Register (MSR.REG, offset 6; eg, 0x3FE or 0x2FE)
 */
SerialPort.MSR = {};
SerialPort.MSR.REG          = 6;        // Modem Status Register
SerialPort.MSR.DCTS         = 0x01;     // when set, CTS (Clear To Send) has changed since last read
SerialPort.MSR.DDSR         = 0x02;     // when set, DSR (Data Set Ready) has changed since last read
SerialPort.MSR.TERI         = 0x04;     // when set, TERI (Trailing Edge Ring Indicator) indicates RI has changed from 1 to 0
SerialPort.MSR.DRLSD        = 0x08;     // when set, RLSD (Received Line Signal Detector) has changed
SerialPort.MSR.CTS          = 0x10;     // when set, the modem or data set is ready to exchange data (complement of the Clear To Send input signal)
SerialPort.MSR.DSR          = 0x20;     // when set, the modem or data set is ready to establish link (complement of the Data Set Ready input signal)
SerialPort.MSR.RI           = 0x40;     // complement of the RI (Ring Indicator) input
SerialPort.MSR.RLSD         = 0x80;     // complement of the RLSD (Received Line Signal Detect) input

/*
 * Scratch Register (SCR.REG, offset 7; eg, 0x3FF or 0x2FF)
 */
SerialPort.SCR = {REG: 7};

/**
 * attachMouse(id, mouse, fnUpdate)
 *
 * @this {SerialPort}
 * @param {string} id
 * @param {Mouse} mouse
 * @param {function(number)} fnUpdate
 * @return {Component|null}
 */
SerialPort.prototype.attachMouse = function(id, mouse, fnUpdate)
{
    var component = null;
    if (id == this.idComponent && !this.connection) {
        this.connection = mouse;
        this.updateStatus = fnUpdate;
        this.fNullModem = false;
        component = this;
    }
    return component;
};

/**
 * setBinding(sHTMLType, sBinding, control, sValue)
 *
 * @this {SerialPort}
 * @param {string|null} sHTMLType is the type of the HTML control (eg, "button", "list", "text", "submit", "textarea", "canvas")
 * @param {string} sBinding is the value of the 'binding' parameter stored in the HTML control's "data-value" attribute (eg, "buffer")
 * @param {Object} control is the HTML control DOM object (eg, HTMLButtonElement)
 * @param {string} [sValue] optional data value
 * @return {boolean} true if binding was successful, false if unrecognized binding request
 */
SerialPort.prototype.setBinding = function(sHTMLType, sBinding, control, sValue)
{
    var serial = this;

    switch (sBinding) {
    case SerialPort.sIOBuffer:
        this.bindings[sBinding] = this.controlIOBuffer = control;

        /*
         * By establishing an onkeypress handler here, we make it possible for DOS commands like
         * "CTTY COM1" to more or less work (use "CTTY CON" to restore control to the DOS console).
         */
        control.onkeydown = function onKeyDown(event) {
            /*
             * This is required in addition to onkeypress, because it's the only way to prevent
             * BACKSPACE (keyCode 8) from being interpreted by the browser as a "Back" operation;
             * moreover, not all browsers generate an onkeypress notification for BACKSPACE.
             *
             * A related problem exists for Ctrl-key combinations in most Windows-based browsers
             * (eg, IE, Edge, Chrome for Windows, etc), because keys like Ctrl-C and Ctrl-S have
             * special meanings (eg, Copy, Save).  To the extent the browser will allow it, we
             * attempt to disable that default behavior when this control receives an onkeydown
             * event for one of those keys (probably the only event the browser generates for them).
             */
            event = event || window.event;
            var keyCode = event.keyCode;
            if (keyCode === 0x08 || event.ctrlKey && keyCode >= 0x41 && keyCode <= 0x5A) {
                if (event.preventDefault) event.preventDefault();
                if (keyCode > 0x40) keyCode -= 0x40;
                serial.receiveData(keyCode);
            }
            return true;
        };

        control.onkeypress = function onKeyPress(event) {
            /*
             * Browser-independent keyCode extraction; refer to onKeyPress() and the other key event
             * handlers in keyboard.js.
             */
            event = event || window.event;
            var keyCode = event.which || event.keyCode;
            serial.receiveData(keyCode);
            /*
             * Since we're going to remove the "readonly" attribute from the <textarea> control
             * (so that the soft keyboard activates on iOS), instead of calling preventDefault() for
             * selected keys (eg, the SPACE key, whose default behavior is to scroll the page), we must
             * now call it for *all* keys, so that the keyCode isn't added to the control immediately,
             * on top of whatever the machine is echoing back, resulting in double characters.
             */
            if (event.preventDefault) event.preventDefault();
            return true;
        };

        /*
         * Now that we've added an onkeypress handler that calls preventDefault() for ALL keys, the control
         * itself no longer needs the "readonly" attribute; we primarily need to remove it for iOS browsers,
         * so that the soft keyboard will activate, but it shouldn't hurt to remove the attribute for all browsers.
         */
        control.removeAttribute("readonly");

        return true;

    default:
        break;
    }
    return false;
};

/**
 * initBus(cmp, bus, cpu, dbg)
 *
 * @this {SerialPort}
 * @param {Computer} cmp
 * @param {Bus} bus
 * @param {X86CPU} cpu
 * @param {DebuggerX86} dbg
 */
SerialPort.prototype.initBus = function(cmp, bus, cpu, dbg)
{
    this.cmp = cmp;
    this.bus = bus;
    this.cpu = cpu;
    this.dbg = dbg;

    this.chipset = cmp.getMachineComponent("ChipSet");

    bus.addPortInputTable(this, SerialPort.aPortInput, this.portBase);
    bus.addPortOutputTable(this, SerialPort.aPortOutput, this.portBase);

    this.setReady();
};

/**
 * initConnection(fNullModem)
 *
 * If a machine 'connection' parameter exists of the form "{sourcePort}->{targetMachine}.{targetPort}",
 * and "{sourcePort}" matches our idComponent, then look for a component with id "{targetMachine}.{targetPort}".
 *
 * If the target component is found, then verify that it has exported functions with the following names:
 *
 *      receiveData(data): called when we have data to transmit; aliased internally to sendData(data)
 *      receiveStatus(pins): called when our control signals have changed; aliased internally to updateStatus(pins)
 *
 * For now, we're not going to worry about communication in the other direction, because when the target component
 * performs its own initConnection(), it will find our receiveData() and receiveStatus() functions, at which point
 * communication in both directions should be established, and the circle of life complete.
 *
 * For added robustness, if the target machine initializes much more slowly than we do, and our connection attempt
 * fails, that's OK, because when it finally initializes, its initConnection() will call our initConnection();
 * if we've already initialized, no harm done.
 *
 * @this {SerialPort}
 * @param {boolean} [fNullModem] (caller's null-modem setting, to ensure our settings are in agreement)
 */
SerialPort.prototype.initConnection = function(fNullModem)
{
    if (!this.connection) {
        var sConnection = this.cmp.getMachineParm("connection");
        if (sConnection) {
            var asParts = sConnection.split('->');
            if (asParts.length == 2) {
                var sSourceID = str.trim(asParts[0]);
                if (sSourceID != this.idComponent) return;  // this connection string is intended for another instance
                var sTargetID = str.trim(asParts[1]);
                this.connection = Component.getComponentByID(sTargetID);
                if (this.connection) {
                    var exports = this.connection['exports'];
                    if (exports) {
                        var fnConnect = exports['connect'];
                        if (fnConnect) fnConnect.call(this.connection, this.fNullModem);
                        this.sendData = exports['receiveData'];
                        if (this.sendData) {
                            this.fNullModem = fNullModem;
                            this.updateStatus = exports['receiveStatus'];
                            this.status(this.idMachine + '.' + sSourceID + " connected to " + sTargetID);
                            return;
                        }
                    }
                }
            }
            /*
             * Changed from notice() to status() because sometimes a connection fails simply because one of us is a laggard.
             */
            this.status("Unable to establish connection: " + sConnection);
        }
    }
};

/**
 * powerUp(data, fRepower)
 *
 * @this {SerialPort}
 * @param {Object|null} data
 * @param {boolean} [fRepower]
 * @return {boolean} true if successful, false if failure
 */
SerialPort.prototype.powerUp = function(data, fRepower)
{
    if (!fRepower) {

        /*
         * This is as late as we can currently wait to make our first inter-machine connection attempt;
         * even so, the target machine's initialization process may still be ongoing, so any connection
         * may be not fully resolved until the target machine performs its own initConnection(), which will
         * in turn invoke our initConnection() again.
         */
        this.initConnection(this.fNullModem);

        if (!data || !this.restore) {
            this.reset();
        } else {
            if (!this.restore(data)) return false;
        }
    }
    return true;
};

/**
 * powerDown(fSave, fShutdown)
 *
 * @this {SerialPort}
 * @param {boolean} [fSave]
 * @param {boolean} [fShutdown]
 * @return {Object|boolean} component state if fSave; otherwise, true if successful, false if failure
 */
SerialPort.prototype.powerDown = function(fSave, fShutdown)
{
    return fSave? this.save() : true;
};

/**
 * reset()
 *
 * @this {SerialPort}
 */
SerialPort.prototype.reset = function()
{
    this.initState();
};

/**
 * save()
 *
 * This implements save support for the SerialPort component.
 *
 * @this {SerialPort}
 * @return {Object}
 */
SerialPort.prototype.save = function()
{
    var state = new State(this);
    state.set(0, this.saveRegisters());
    return state.data();
};

/**
 * restore(data)
 *
 * This implements restore support for the SerialPort component.
 *
 * @this {SerialPort}
 * @param {Object} data
 * @return {boolean} true if successful, false if failure
 */
SerialPort.prototype.restore = function(data)
{
    return this.initState(data[0]);
};

/**
 * initState(data)
 *
 * @this {SerialPort}
 * @param {Array} [data]
 * @return {boolean} true if successful, false if failure
 */
SerialPort.prototype.initState = function(data)
{
    /*
     * The NS8250A spec doesn't explicitly say what the RBR and THR are initialized to on a reset,
     * but I think we can safely assume zeros.  Similarly, we reset the baud rate Divisor Latch (wDL)
     * to an arbitrary but consistent default (DL_DEFAULT).
     */
    var i = 0;
    if (data === undefined) {
        data = [
            0,                                          // RBR
            0,                                          // THR
            SerialPort.DL_DEFAULT,                      // DL
            0,                                          // IER
            SerialPort.IIR.NO_INT,                      // IIR
            0,                                          // LCR
            0,                                          // MCR
            SerialPort.LSR.THRE | SerialPort.LSR.TSRE,  // LSR
            this.bMSRInit,                              // MSR
            []
        ];
    }
    this.bRBR = data[i++];
    this.bTHR = data[i++];
    this.wDL =  data[i++];
    this.bIER = data[i++];
    this.bIIR = data[i++];
    this.bLCR = data[i++];
    this.bMCR = data[i++];
    this.bLSR = data[i++];
    this.bMSR = data[i++];
    this.abReceive = data[i];
    return true;
};

/**
 * saveRegisters()
 *
 * @this {SerialPort}
 * @return {Array}
 */
SerialPort.prototype.saveRegisters = function()
{
    var i = 0;
    var data = [];
    data[i++] = this.bRBR;
    data[i++] = this.bTHR;
    data[i++] = this.wDL;
    data[i++] = this.bIER;
    data[i++] = this.bIIR;
    data[i++] = this.bLCR;
    data[i++] = this.bMCR;
    data[i++] = this.bLSR;
    data[i++] = this.bMSR;
    data[i] = this.abReceive;
    return data;
};

/**
 * receiveData(data)
 *
 * This replaces the old sendRBR() function, which expected an Array of bytes.  We still support that,
 * but in order to support connections with other SerialPort components (ie, the PC8080 SerialPort), we
 * have added support for numbers and strings as well.
 *
 * @this {SerialPort}
 * @param {number|string|Array} data
 * @return {boolean} true if received, false if not
 */
SerialPort.prototype.receiveData = function(data)
{
    if (typeof data == "number") {
        this.abReceive.push(data);
    }
    else if (typeof data == "string") {
        for (var i = 0; i < data.length; i++) {
            this.abReceive.push(data.charCodeAt(i));
        }
    }
    else {
        this.abReceive = this.abReceive.concat(data);
    }
    this.advanceRBR();
    return true;                // for now, return true regardless, since we're buffering everything anyway
};

/**
 * receiveStatus(pins)
 *
 * NOTE: Prior to the addition of this interface, the CTS and DSR bits were initialized set and remained set for the life
 * of the machine.  It is entirely appropriate that this is the only way those bits can be changed, because they represent
 * external control signals.
 *
 * @this {SerialPort}
 * @param {number} pins
 */
SerialPort.prototype.receiveStatus = function(pins)
{
    var bMSROld = this.bMSR;
    this.bMSR &= ~(SerialPort.MSR.CTS | SerialPort.MSR.DSR);
    if (pins & RS232.CTS.MASK) {
        this.bMSR |= SerialPort.MSR.CTS | SerialPort.MSR.DCTS;
    }
    if (pins & RS232.DSR.MASK) {
        this.bMSR |= SerialPort.MSR.DSR | SerialPort.MSR.DDSR;
    }
    if (bMSROld != this.bMSR) this.updateIRR();
};

/**
 * advanceRBR()
 *
 * @this {SerialPort}
 */
SerialPort.prototype.advanceRBR = function()
{
    if (this.abReceive.length > 0 && !(this.bLSR & SerialPort.LSR.DR)) {
        this.bRBR = this.abReceive.shift();
        this.bLSR |= SerialPort.LSR.DR;
    }
    this.updateIRR();
};

/**
 * inRBR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3F8 or 0x2F8)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inRBR = function(port, addrFrom)
{
    var b = ((this.bLCR & SerialPort.LCR.DLAB) ? (this.wDL & 0xff) : this.bRBR);
    this.printMessageIO(port, null, addrFrom, (this.bLCR & SerialPort.LCR.DLAB) ? "DLL" : "RBR", b);
    this.bLSR &= ~SerialPort.LSR.DR;
    this.advanceRBR();
    return b;
};

/**
 * inIER(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3F9 or 0x2F9)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inIER = function(port, addrFrom)
{
    var b = ((this.bLCR & SerialPort.LCR.DLAB) ? (this.wDL >> 8) : this.bIER);
    this.printMessageIO(port, null, addrFrom, (this.bLCR & SerialPort.LCR.DLAB) ? "DLM" : "IER", b);
    return b;
};

/**
 * inIIR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FA or 0x2FA)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inIIR = function(port, addrFrom)
{
    var b = this.bIIR;
    this.printMessageIO(port, null, addrFrom, "IIR", b);
    return b;
};

/**
 * inLCR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FB or 0x2FB)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inLCR = function(port, addrFrom)
{
    var b = this.bLCR;
    this.printMessageIO(port, null, addrFrom, "LCR", b);
    return b;
};

/**
 * inMCR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FC or 0x2FC)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inMCR = function(port, addrFrom)
{
    var b = this.bMCR;
    this.printMessageIO(port, null, addrFrom, "MCR", b);
    return b;
};

/**
 * inLSR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FD or 0x2FD)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inLSR = function(port, addrFrom)
{
    var b = this.bLSR;
    this.printMessageIO(port, null, addrFrom, "LSR", b);
    return b;
};

/**
 * inMSR(port, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FE or 0x2FE)
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
SerialPort.prototype.inMSR = function(port, addrFrom)
{
    var b = this.bMSR;
    this.bMSR &= ~(SerialPort.MSR.DCTS | SerialPort.MSR.DDSR);
    this.printMessageIO(port, null, addrFrom, "MSR", b);
    return b;
};

/**
 * outTHR(port, bOut, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3F8 or 0x2F8)
 * @param {number} bOut
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to write the specified port)
 */
SerialPort.prototype.outTHR = function(port, bOut, addrFrom)
{
    this.printMessageIO(port, bOut, addrFrom, (this.bLCR & SerialPort.LCR.DLAB) ? "DLL" : "THR");
    if (this.bLCR & SerialPort.LCR.DLAB) {
        this.wDL = (this.wDL & ~0xff) | bOut;
    } else {
        this.bTHR = bOut;
        this.bLSR &= ~(SerialPort.LSR.THRE | SerialPort.LSR.TSRE);
        if (this.transmitByte(bOut)) {
            this.bLSR |= (SerialPort.LSR.THRE | SerialPort.LSR.TSRE);
            /*
             * QUESTION: Does this mean we should also flush/zero bTHR?
             */
        }
    }
};

/**
 * outIER(port, bOut, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3F9 or 0x2F9)
 * @param {number} bOut
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to write the specified port)
 */
SerialPort.prototype.outIER = function(port, bOut, addrFrom)
{
    this.printMessageIO(port, bOut, addrFrom, (this.bLCR & SerialPort.LCR.DLAB) ? "DLM" : "IER");
    if (this.bLCR & SerialPort.LCR.DLAB) {
        this.wDL = (this.wDL & 0xff) | (bOut << 8);
    } else {
        this.bIER = bOut;
    }
};

/**
 * outLCR(port, bOut, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FB or 0x2FB)
 * @param {number} bOut
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to write the specified port)
 */
SerialPort.prototype.outLCR = function(port, bOut, addrFrom)
{
    this.printMessageIO(port, bOut, addrFrom, "LCR");
    this.bLCR = bOut;
};

/**
 * outMCR(port, bOut, addrFrom)
 *
 * @this {SerialPort}
 * @param {number} port (eg, 0x3FC or 0x2FC)
 * @param {number} bOut
 * @param {number} [addrFrom] (not defined whenever the Debugger tries to write the specified port)
 */
SerialPort.prototype.outMCR = function(port, bOut, addrFrom)
{
    var delta = (bOut ^ this.bMCR);
    this.printMessageIO(port, bOut, addrFrom, "MCR");
    this.bMCR = bOut;
    /*
     * Whenever DTR or RTS changes, we also need to notify any connected machine or mouse, via updateStatus().
     */
    if (delta & (SerialPort.MCR.DTR | SerialPort.MCR.RTS)) {
        if (this.updateStatus) {
            var pins = 0;
            if (this.fNullModem) {
                pins |= (bOut & SerialPort.MCR.RTS)? RS232.CTS.MASK : 0;
                pins |= (bOut & SerialPort.MCR.DTR)? (RS232.DSR.MASK | RS232.CD.MASK): 0;
            } else {
                pins |= (bOut & SerialPort.MCR.RTS)? RS232.RTS.MASK : 0;
                pins |= (bOut & SerialPort.MCR.DTR)? RS232.DTR.MASK : 0;
            }
            this.updateStatus.call(this.connection, pins);
        }
    }
};

/**
 * updateIRR()
 *
 * @this {SerialPort}
 */
SerialPort.prototype.updateIRR = function()
{
    var bIIR = -1;
    if ((this.bLSR & SerialPort.LSR.DR) && (this.bIER & SerialPort.IER.RBR_AVAIL)) {
        bIIR = SerialPort.IIR.INT_RBR;
    }
    else if ((this.bMSR & (SerialPort.MSR.DCTS | SerialPort.MSR.DDSR)) && (this.bIER & SerialPort.IER.MSR_DELTA)) {
        bIIR = SerialPort.IIR.INT_MSR;
    }
    if (bIIR >= 0) {
        this.bIIR &= ~(SerialPort.IIR.NO_INT | SerialPort.IIR.INT_BITS);
        this.bIIR |= bIIR;
        /*
         * TODO: Remove this arbitrary 100-instruction delay once we've added support for baud rate throttling
         * (see TODO above regarding baud rate).
         */
        if (this.chipset && this.nIRQ) this.chipset.setIRR(this.nIRQ, 100);
    } else {
        this.bIIR |= SerialPort.IIR.NO_INT;
        if (this.chipset && this.nIRQ) this.chipset.clearIRR(this.nIRQ);
    }
};

/**
 * transmitByte(b)
 *
 * @this {SerialPort}
 * @param {number} b
 * @return {boolean} true if transmitted, false if not
 */
SerialPort.prototype.transmitByte = function(b)
{
    var fTransmitted = false;

    this.printMessage("transmitByte(" + str.toHexByte(b) + ")");

    if (this.sendData) {
        if (this.sendData.call(this.connection, b)) {
            fTransmitted = true;
        }
    }

    if (this.controlIOBuffer) {
        if (b == 0x0D) {
            this.iLogicalCol = 0;
        }
        else if (b == 0x08) {
            this.controlIOBuffer.value = this.controlIOBuffer.value.slice(0, -1);
            /*
             * TODO: Back up the correct number of columns if the character erased was a tab.
             */
            if (this.iLogicalCol > 0) this.iLogicalCol--;
        }
        else {
            var s = str.toASCIICode(b); // formerly: String.fromCharCode(b);
            var nChars = s.length;      // formerly: (b >= 0x20? 1 : 0);
            if (b < 0x20 && nChars == 1) nChars = 0;
            if (b == 0x09) {
                var tabSize = this.tabSize || 8;
                nChars = tabSize - (this.iLogicalCol % tabSize);
                if (this.tabSize) s = str.pad("", nChars);
            }
            if (this.charBOL && !this.iLogicalCol && nChars) s = String.fromCharCode(this.charBOL) + s;
            this.controlIOBuffer.value += s;
            this.controlIOBuffer.scrollTop = this.controlIOBuffer.scrollHeight;
            this.iLogicalCol += nChars;
        }
        fTransmitted = true;
    }
    else if (this.consoleOutput != null) {
        if (b == 0x0A || this.consoleOutput.length >= 1024) {
            this.println(this.consoleOutput);
            this.consoleOutput = "";
        }
        if (b != 0x0A) {
            this.consoleOutput += String.fromCharCode(b);
        }
        fTransmitted = true;
    }

    return fTransmitted;
};

/*
 * Port input notification table
 */
SerialPort.aPortInput = {
    0x0: SerialPort.prototype.inRBR,    // or DLL if DLAB set
    0x1: SerialPort.prototype.inIER,    // or DLM if DLAB set
    0x2: SerialPort.prototype.inIIR,
    0x3: SerialPort.prototype.inLCR,
    0x4: SerialPort.prototype.inMCR,
    0x5: SerialPort.prototype.inLSR,
    0x6: SerialPort.prototype.inMSR
};

/*
 * Port output notification table
 */
SerialPort.aPortOutput = {
    0x0: SerialPort.prototype.outTHR,   // or DLL if DLAB set
    0x1: SerialPort.prototype.outIER,   // or DLM if DLAB set
    0x3: SerialPort.prototype.outLCR,
    0x4: SerialPort.prototype.outMCR
};

/**
 * SerialPort.init()
 *
 * This function operates on every HTML element of class "serial", extracting the
 * JSON-encoded parameters for the SerialPort constructor from the element's "data-value"
 * attribute, invoking the constructor to create a SerialPort component, and then binding
 * any associated HTML controls to the new component.
 */
SerialPort.init = function()
{
    var aeSerial = Component.getElementsByClass(document, PCX86.APPCLASS, "serial");
    for (var iSerial = 0; iSerial < aeSerial.length; iSerial++) {
        var eSerial = aeSerial[iSerial];
        var parmsSerial = Component.getComponentParms(eSerial);
        var serial = new SerialPort(parmsSerial);
        Component.bindComponentControls(serial, eSerial, PCX86.APPCLASS);
    }
};

/*
 * Initialize every SerialPort module on the page.
 */
web.onInit(SerialPort.init);

if (NODE) module.exports = SerialPort;
