/*
 * Copyright (C) 2020 Ben Smith
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the LICENSE file for details.
 *
 *
 * Some code from GB-Studio, see LICENSE.gbstudio
 */
"use strict";

// User configurable.
const ROM_FILENAME = 'tdgbd.gb';
const ENABLE_FAST_FORWARD = true;
const ENABLE_REWIND = true;
const ENABLE_PAUSE = false;
const ENABLE_SWITCH_PALETTES = true;
const OSGP_DEADZONE = 0.1;    // On screen gamepad deadzone range
const CGB_COLOR_CURVE = 0;    // 0: none, 1: Sameboy "Emulate Hardware" 2: Gambatte/Gameboy Online

// List of DMG palettes to switch between. By default it includes all 84
// built-in palettes. If you want to restrict this, change it to an array of
// the palettes you want to use and change DEFAULT_PALETTE_IDX to the index of the
// default palette in that list.
//
// Example: (only allow one palette with index 16):
//   const DEFAULT_PALETTE_IDX = 0;
//   const PALETTES = [16];
//
// Example: (allow three palettes, 16, 32, 64, with default 32):
//   const DEFAULT_PALETTE_IDX = 1;
//   const PALETTES = [16, 32, 64];
//
const DEFAULT_PALETTE_IDX = 0;
const PALETTES = [0, 75, 64];

// Probably OK to leave these alone too.
const AUDIO_FRAMES = 4096;      // Number of audio frames pushed per buffer
const AUDIO_LATENCY_SEC = 0.1;
const MAX_UPDATE_SEC = 5 / 60;  // Max. time to run emulator per step (== 5 frames)

// Constants
const RESULT_OK = 0;
const RESULT_ERROR = 1;
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const CPU_TICKS_PER_SECOND = 4194304;
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;

const $ = document.querySelector.bind(document);
let emulator = null;

const controllerEl = $('#controller');
const dpadEl = $('#controller_dpad');
const selectEl = $('#controller_select');
const startEl = $('#controller_start');
const bEl = $('#controller_b');
const aEl = $('#controller_a');

const binjgbPromise = Binjgb();

const changePal = palIdx => {
  emulator.setBuiltinPalette(palIdx);
};

// Extract stuff from the vue.js implementation in demo.js.
class VM {
  constructor() {
    this.ticks = 0;
    this.extRamUpdated = false;
    this.paused_ = false;
    this.volume = 0.5;
    this.palIdx = DEFAULT_PALETTE_IDX;
    setInterval(() => {
      if (this.extRamUpdated) {
        this.updateExtRam();
        this.extRamUpdated = false;
      }
    }, 1000);
  }

  get paused() { return this.paused_; }
  set paused(newPaused) {
    let oldPaused = this.paused_;
    this.paused_ = newPaused;
    if (!emulator) return;
    if (newPaused == oldPaused) return;
    if (newPaused) {
      emulator.pause();
      this.ticks = emulator.ticks;
    } else {
      emulator.resume();
    }
  }

  togglePause() {
    this.paused = !this.paused;
  }

  updateExtRam() {
    if (!emulator) return;
    const extram = emulator.getExtRam();
    localStorage.setItem('extram', JSON.stringify(Array.from(extram)));
  }
};

const vm = new VM();

// Load a ROM.
(async function go() {
  let response = await fetch(ROM_FILENAME);
  let romBuffer = await response.arrayBuffer();
  const extRam = new Uint8Array(JSON.parse(localStorage.getItem('extram')));
  Emulator.start(await binjgbPromise, romBuffer, extRam);
  emulator.setBuiltinPalette(vm.palIdx);
})();


// Copied from demo.js
function makeWasmBuffer(module, ptr, size) {
  return new Uint8Array(module.HEAP8.buffer, ptr, size);
}

class Emulator {
  static start(module, romBuffer, extRamBuffer) {
    Emulator.stop();
    emulator = new Emulator(module, romBuffer, extRamBuffer);
    emulator.run();
  }

  static stop() {
    if (emulator) {
      emulator.destroy();
      emulator = null;
    }
  }

  constructor(module, romBuffer, extRamBuffer) {
    this.module = module;
    // Align size up to 32k.
    const size = (romBuffer.byteLength + 0x7fff) & ~0x7fff;
    this.romDataPtr = this.module._malloc(size);
    makeWasmBuffer(this.module, this.romDataPtr, size)
        .fill(0)
        .set(new Uint8Array(romBuffer));
    this.e = this.module._emulator_new_simple(
        this.romDataPtr, size, Audio.ctx.sampleRate, AUDIO_FRAMES,
        CGB_COLOR_CURVE);
    if (this.e == 0) {
      throw new Error('Invalid ROM.');
    }

    this.audio = new Audio(module, this.e);
    this.video = new Video(module, this.e, $('canvas'));

    this.lastRafSec = 0;
    this.leftoverTicks = 0;
    this.fps = 60;
    this.fastForward = false;

    if (extRamBuffer) {
      this.loadExtRam(extRamBuffer);
    }

    this.bindKeys();
    this.bindTouch();

    this.touchEnabled = 'ontouchstart' in document.documentElement;
    this.updateOnscreenGamepad();
  }

  destroy() {
    this.unbindTouch();
    this.unbindKeys();
    this.cancelAnimationFrame();
    clearInterval(this.rewindIntervalId);
    this.module._emulator_delete(this.e);
    this.module._free(this.romDataPtr);
  }

  withNewFileData(cb) {
    const fileDataPtr = this.module._ext_ram_file_data_new(this.e);
    const buffer = makeWasmBuffer(
        this.module, this.module._get_file_data_ptr(fileDataPtr),
        this.module._get_file_data_size(fileDataPtr));
    const result = cb(fileDataPtr, buffer);
    this.module._file_data_delete(fileDataPtr);
    return result;
  }

  loadExtRam(extRamBuffer) {
    this.withNewFileData((fileDataPtr, buffer) => {
      if (buffer.byteLength === extRamBuffer.byteLength) {
        buffer.set(new Uint8Array(extRamBuffer));
        this.module._emulator_read_ext_ram(this.e, fileDataPtr);
      }
    });
  }

  getExtRam() {
    return this.withNewFileData((fileDataPtr, buffer) => {
      this.module._emulator_write_ext_ram(this.e, fileDataPtr);
      return new Uint8Array(buffer);
    });
  }

  get isPaused() {
    return this.rafCancelToken === null;
  }

  pause() {
    if (!this.isPaused) {
      this.cancelAnimationFrame();
      this.audio.pause();
      this.beginRewind();
    }
  }

  resume() {
    if (this.isPaused) {
      this.endRewind();
      this.requestAnimationFrame();
      this.audio.resume();
    }
  }

  setBuiltinPalette(palIdx) {
    this.module._emulator_set_builtin_palette(this.e, PALETTES[palIdx]);
  }

  requestAnimationFrame() {
    this.rafCancelToken = requestAnimationFrame(this.rafCallback.bind(this));
  }

  cancelAnimationFrame() {
    cancelAnimationFrame(this.rafCancelToken);
    this.rafCancelToken = null;
  }

  run() {
    this.requestAnimationFrame();
  }

  get ticks() {
    return this.module._emulator_get_ticks_f64(this.e);
  }

  runUntil(ticks) {
    while (true) {
      const event = this.module._emulator_run_until_f64(this.e, ticks);
      if (event & EVENT_NEW_FRAME) {
        this.video.uploadTexture();
      }
      if ((event & EVENT_AUDIO_BUFFER_FULL) && !this.isRewinding) {
        this.audio.pushBuffer();
      }
      if (event & EVENT_UNTIL_TICKS) {
        break;
      }
    }
    if (this.module._emulator_was_ext_ram_updated(this.e)) {
      vm.extRamUpdated = true;
    }
  }

  rafCallback(startMs) {
    this.requestAnimationFrame();
    let deltaSec = 0;
    if (!this.isRewinding) {
      const startSec = startMs / 1000;
      deltaSec = Math.max(startSec - (this.lastRafSec || startSec), 0);

      const startTimeMs = performance.now();
      const deltaTicks =
          Math.min(deltaSec, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND;
      let runUntilTicks = this.ticks + deltaTicks - this.leftoverTicks;
      this.runUntil(runUntilTicks);
      const deltaTimeMs = performance.now() - startTimeMs;
      const deltaTimeSec = deltaTimeMs / 1000;

      if (this.fastForward) {
        // Estimate how much faster we can run in fast-forward, keeping the
        // same rAF update rate.
        const speedUp = (deltaTicks / CPU_TICKS_PER_SECOND) / deltaTimeSec;
        const extraFrames = Math.floor(speedUp - deltaTimeSec);
        const extraTicks = extraFrames * deltaTicks;
        runUntilTicks = this.ticks + extraTicks - this.leftoverTicks;
        this.runUntil(runUntilTicks);
      }

      this.leftoverTicks = (this.ticks - runUntilTicks) | 0;
      this.lastRafSec = startSec;
    }
    const lerp = (from, to, alpha) => (alpha * from) + (1 - alpha) * to;
    this.fps = lerp(this.fps, Math.min(1 / deltaSec, 10000), 0.3);
    this.video.renderTexture();
  }

  updateOnscreenGamepad() {
    $('#controller').style.display = this.touchEnabled ? 'block' : 'none';
  }

  bindTouch() {
    this.touchFuncs = {
      'controller_b': this.setJoypB.bind(this),
      'controller_a': this.setJoypA.bind(this),
      'controller_start': this.setJoypStart.bind(this),
      'controller_select': this.setJoypSelect.bind(this),
    };

    this.boundButtonTouchStart = this.buttonTouchStart.bind(this);
    this.boundButtonTouchEnd = this.buttonTouchEnd.bind(this);
    selectEl.addEventListener('touchstart', this.boundButtonTouchStart);
    selectEl.addEventListener('touchend', this.boundButtonTouchEnd);
    startEl.addEventListener('touchstart', this.boundButtonTouchStart);
    startEl.addEventListener('touchend', this.boundButtonTouchEnd);
    bEl.addEventListener('touchstart', this.boundButtonTouchStart);
    bEl.addEventListener('touchend', this.boundButtonTouchEnd);
    aEl.addEventListener('touchstart', this.boundButtonTouchStart);
    aEl.addEventListener('touchend', this.boundButtonTouchEnd);

    this.boundDpadTouchStartMove = this.dpadTouchStartMove.bind(this);
    this.boundDpadTouchEnd = this.dpadTouchEnd.bind(this);
    dpadEl.addEventListener('touchstart', this.boundDpadTouchStartMove);
    dpadEl.addEventListener('touchmove', this.boundDpadTouchStartMove);
    dpadEl.addEventListener('touchend', this.boundDpadTouchEnd);

    this.boundTouchRestore = this.touchRestore.bind(this);
    window.addEventListener('touchstart', this.boundTouchRestore);
  }

  unbindTouch() {
    selectEl.removeEventListener('touchstart', this.boundButtonTouchStart);
    selectEl.removeEventListener('touchend', this.boundButtonTouchEnd);
    startEl.removeEventListener('touchstart', this.boundButtonTouchStart);
    startEl.removeEventListener('touchend', this.boundButtonTouchEnd);
    bEl.removeEventListener('touchstart', this.boundButtonTouchStart);
    bEl.removeEventListener('touchend', this.boundButtonTouchEnd);
    aEl.removeEventListener('touchstart', this.boundButtonTouchStart);
    aEl.removeEventListener('touchend', this.boundButtonTouchEnd);

    dpadEl.removeEventListener('touchstart', this.boundDpadTouchStartMove);
    dpadEl.removeEventListener('touchmove', this.boundDpadTouchStartMove);
    dpadEl.removeEventListener('touchend', this.boundDpadTouchEnd);

    window.removeEventListener('touchstart', this.boundTouchRestore);
  }

  buttonTouchStart(event) {
    if (event.currentTarget.id in this.touchFuncs) {
      this.touchFuncs[event.currentTarget.id](true);
      event.currentTarget.classList.add('btnPressed');
      event.preventDefault();
    }
  }

  buttonTouchEnd(event) {
    if (event.currentTarget.id in this.touchFuncs) {
      this.touchFuncs[event.currentTarget.id](false);
      event.currentTarget.classList.remove('btnPressed');
      event.preventDefault();
    }
  }

  dpadTouchStartMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (2 * (event.targetTouches[0].clientX - rect.left)) / rect.width - 1;
    const y = (2 * (event.targetTouches[0].clientY - rect.top)) / rect.height - 1;

    if (Math.abs(x) > OSGP_DEADZONE) {
      if (y > x && y < -x) {
        this.setJoypLeft(true);
        this.setJoypRight(false);
      } else if (y < x && y > -x) {
        this.setJoypLeft(false);
        this.setJoypRight(true);
      }
    } else {
      this.setJoypLeft(false);
      this.setJoypRight(false);
    }

    if (Math.abs(y) > OSGP_DEADZONE) {
      if (x > y && x < -y) {
        this.setJoypUp(true);
        this.setJoypDown(false);
      } else if (x < y && x > -y) {
        this.setJoypUp(false);
        this.setJoypDown(true);
      }
    } else {
      this.setJoypUp(false);
      this.setJoypDown(false);
    }
    event.preventDefault();
  }

  dpadTouchEnd(event) {
    this.setJoypLeft(false);
    this.setJoypRight(false);
    this.setJoypUp(false);
    this.setJoypDown(false);
    event.preventDefault();
  }

  touchRestore() {
    this.touchEnabled = true;
    this.updateOnscreenGamepad();
  }

  bindKeys() {
    this.keyFuncs = {
      'KeyS': this.setJoypDown.bind(this),
      'KeyA': this.setJoypLeft.bind(this),
      'KeyD': this.setJoypRight.bind(this),
      'KeyW': this.setJoypUp.bind(this),
      'KeyK': this.setJoypB.bind(this),
      'KeyL': this.setJoypA.bind(this),
      'Enter': this.setJoypStart.bind(this),
      'Tab': this.setJoypSelect.bind(this),
      'Backspace': this.keyRewind.bind(this),
      'Space': this.keyPause.bind(this),
      'BracketLeft': this.keyPrevPalette.bind(this),
      'BracketRight': this.keyNextPalette.bind(this),
      'ShiftLeft': this.setFastForward.bind(this),
    };
    this.boundKeyDown = this.keyDown.bind(this);
    this.boundKeyUp = this.keyUp.bind(this);

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
  }

  unbindKeys() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
  }

  keyDown(event) {
    if (event.code in this.keyFuncs) {
      if (this.touchEnabled) {
        this.touchEnabled = false;
        this.updateOnscreenGamepad();
      }
      this.keyFuncs[event.code](true);
      event.preventDefault();
    }
  }

  keyUp(event) {
    if (event.code in this.keyFuncs) {
      this.keyFuncs[event.code](false);
      event.preventDefault();
    }
  }

  keyRewind(isKeyDown) {
    if (!ENABLE_REWIND) { return; }
    if (this.isRewinding !== isKeyDown) {
      if (isKeyDown) {
        vm.paused = true;
        this.autoRewind = true;
      } else {
        this.autoRewind = false;
        vm.paused = false;
      }
    }
  }

  keyPause(isKeyDown) {
    if (!ENABLE_PAUSE) { return; }
    if (isKeyDown) vm.togglePause();
  }

  keyPrevPalette(isKeyDown) {
    if (!ENABLE_SWITCH_PALETTES) { return; }
    if (isKeyDown) {
      vm.palIdx = (vm.palIdx + PALETTES.length - 1) % PALETTES.length;
      emulator.setBuiltinPalette(vm.palIdx);
    }
  }

  keyNextPalette(isKeyDown) {
    if (!ENABLE_SWITCH_PALETTES) { return; }
    if (isKeyDown) {
      vm.palIdx = (vm.palIdx + 1) % PALETTES.length;
      emulator.setBuiltinPalette(vm.palIdx);
    }
  }

  setFastForward(isKeyDown) {
    if (!ENABLE_FAST_FORWARD) { return; }
    this.fastForward = isKeyDown;
  }

  setJoypDown(set) { this.module._set_joyp_down(this.e, set); }
  setJoypUp(set) { this.module._set_joyp_up(this.e, set); }
  setJoypLeft(set) { this.module._set_joyp_left(this.e, set); }
  setJoypRight(set) { this.module._set_joyp_right(this.e, set); }
  setJoypSelect(set) { this.module._set_joyp_select(this.e, set); }
  setJoypStart(set) { this.module._set_joyp_start(this.e, set); }
  setJoypB(set) { this.module._set_joyp_B(this.e, set); }
  setJoypA(set) { this.module._set_joyp_A(this.e, set); }
}

class Audio {
  constructor(module, e) {
    this.started = false;
    this.module = module;
    this.buffer = makeWasmBuffer(
        this.module, this.module._get_audio_buffer_ptr(e),
        this.module._get_audio_buffer_capacity(e));
    this.startSec = 0;
    this.resume();

    this.boundStartPlayback = this.startPlayback.bind(this);
    window.addEventListener('keydown', this.boundStartPlayback, true);
    window.addEventListener('click', this.boundStartPlayback, true);
    window.addEventListener('touchend', this.boundStartPlayback, true);
  }

  startPlayback() {
    window.removeEventListener('touchend', this.boundStartPlayback, true);
    window.removeEventListener('keydown', this.boundStartPlayback, true);
    window.removeEventListener('click', this.boundStartPlayback, true);
    this.started = true;
    this.resume();
  }

  get sampleRate() { return Audio.ctx.sampleRate; }

  pushBuffer() {
    if (!this.started) { return; }
    const nowSec = Audio.ctx.currentTime;
    const nowPlusLatency = nowSec + AUDIO_LATENCY_SEC;
    const volume = vm.volume;
    this.startSec = (this.startSec || nowPlusLatency);
    if (this.startSec >= nowSec) {
      const buffer = Audio.ctx.createBuffer(2, AUDIO_FRAMES, this.sampleRate);
      const channel0 = buffer.getChannelData(0);
      const channel1 = buffer.getChannelData(1);
      for (let i = 0; i < AUDIO_FRAMES; i++) {
        channel0[i] = this.buffer[2 * i] * volume / 255;
        channel1[i] = this.buffer[2 * i + 1] * volume / 255;
      }
      const bufferSource = Audio.ctx.createBufferSource();
      bufferSource.buffer = buffer;
      bufferSource.connect(Audio.ctx.destination);
      bufferSource.start(this.startSec);
      const bufferSec = AUDIO_FRAMES / this.sampleRate;
      this.startSec += bufferSec;
    } else {
      console.log(
          'Resetting audio (' + this.startSec.toFixed(2) + ' < ' +
          nowSec.toFixed(2) + ')');
      this.startSec = nowPlusLatency;
    }
  }

  pause() {
    if (!this.started) { return; }
    Audio.ctx.suspend();
  }

  resume() {
    if (!this.started) { return; }
    Audio.ctx.resume();
  }
}

Audio.ctx = new AudioContext;

class Video {
  constructor(module, e, el) {
    this.module = module;
    // iPhone Safari doesn't upscale using image-rendering: pixelated on webgl
    // canvases. See https://bugs.webkit.org/show_bug.cgi?id=193895.
    // For now, default to Canvas2D.
    if (window.navigator.userAgent.match(/iPhone|iPad/)) {
      this.renderer = new Canvas2DRenderer(el);
    } else {
      try {
        this.renderer = new WebGLRenderer(el);
      } catch (error) {
        console.log(`Error creating WebGLRenderer: ${error}`);
        this.renderer = new Canvas2DRenderer(el);
      }
    }
    this.buffer = makeWasmBuffer(
        this.module, this.module._get_frame_buffer_ptr(e),
        this.module._get_frame_buffer_size(e));
  }

  uploadTexture() {
    this.renderer.uploadTexture(this.buffer);
  }

  renderTexture() {
    this.renderer.renderTexture();
  }
}

class Canvas2DRenderer {
  constructor(el) {
    this.ctx = el.getContext('2d');
    this.imageData = this.ctx.createImageData(el.width, el.height);
  }

  renderTexture() {
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  uploadTexture(buffer) {
    this.imageData.data.set(buffer);
  }
}

class WebGLRenderer {
  constructor(el) {
    const gl = this.gl = el.getContext('webgl', {preserveDrawingBuffer: true});
    if (gl === null) {
      throw new Error('unable to create webgl context');
    }

    const w = SCREEN_WIDTH / 256;
    const h = SCREEN_HEIGHT / 256;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  0, h,
      +1, -1,  w, h,
      -1, +1,  0, 0,
      +1, +1,  w, 0,
    ]), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`compileShader failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER,
       `attribute vec2 aPos;
        attribute vec2 aTexCoord;
        varying highp vec2 vTexCoord;
        void main(void) {
          gl_Position = vec4(aPos, 0.0, 1.0);
          vTexCoord = aTexCoord;
        }`);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER,
       `varying highp vec2 vTexCoord;
        uniform sampler2D uSampler;
        void main(void) {
          gl_FragColor = texture2D(uSampler, vTexCoord);
        }`);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    const aPos = gl.getAttribLocation(program, 'aPos');
    const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
    const uSampler = gl.getUniformLocation(program, 'uSampler');

    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, gl.FALSE, 16, 0);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, gl.FALSE, 16, 8);
    gl.uniform1i(uSampler, 0);
  }

  renderTexture() {
    this.gl.clearColor(0.5, 0.5, 0.5, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  uploadTexture(buffer) {
    this.gl.texSubImage2D(
        this.gl.TEXTURE_2D, 0, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.gl.RGBA,
        this.gl.UNSIGNED_BYTE, buffer);
  }
}