# Native build

This is the production audio path: JUCE/C++ with an `AudioAppComponent`, a low-pass filter, delay line, spring-like reverb, siren oscillator, and atomic control values suitable for MIDI callbacks.

Requirements on Windows: Visual Studio 2022 with Desktop C++, CMake 3.22+, and an ASIO driver where available.

```powershell
cmake -S native -B native/build -G "Visual Studio 17 2022" -A x64
cmake --build native/build --config Release
```

The first configure downloads JUCE 8.0.4. The existing Electron build remains the visual interaction prototype while this native target is developed into the full deck UI.
