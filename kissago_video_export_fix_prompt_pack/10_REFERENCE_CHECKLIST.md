# Reference Checklist for Coder

Use these references while implementing, but confirm against the installed package version and current code.

## Mediabunny

Mediabunny is a JavaScript/TypeScript media toolkit for reading, writing, and converting media files such as MP4 directly in the browser.

Reference:

- https://mediabunny.dev/guide/introduction

Check in current project:

```txt
Installed Mediabunny version
Output format class being used
Whether writing regular MP4 or fragmented MP4
fastStart option/configuration
Track timestamp configuration
Video/audio codec configuration
Output finalization path
```

## Mediabunny writing files

Writing media files requires correct track setup, timestamps, frame rate expectations, and finalization.

Reference:

- https://mediabunny.dev/guide/writing-media-files

Check:

```txt
Expected frame rate metadata
Frame timestamps
Whether frames are added too frequently
Whether duplicate timestamps can happen
Whether output is finalized before download
```

## Mediabunny output formats

Fragmented MP4 is useful for streaming contexts, but final downloadable MP4 should be tested for broad compatibility. Fast Start matters for metadata placement.

Reference:

- https://mediabunny.dev/guide/output-formats

Check:

```txt
Regular MP4 vs fragmented MP4
fastStart true
Metadata/moov atom placement
Compatibility with VLC/native player/YouTube
```

## WebCodecs

WebCodecs provides low-level browser encoding/decoding control. It may be hardware-accelerated and can run in dedicated workers depending on browser support.

References:

- https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/configure

Check:

```txt
VideoEncoder support
VideoEncoder.isConfigSupported
framerate setting
bitrate setting
latencyMode
hardwareAcceleration
codec support fallback
VideoFrame timestamp/duration handling
VideoFrame close/disposal
```

## YouTube recommended upload settings

YouTube recommends MP4 container, moov atom at the front/Fast Start, H.264 video, and AAC-LC audio with 48 kHz sample rate.

Reference:

- https://support.google.com/youtube/answer/1722171

Check final output:

```txt
MP4 container
No edit lists if configurable
moov atom front / Fast Start
H.264 video
AAC-LC audio
48 kHz audio
Progressive scan
Constant frame rate
No decode/timestamp errors
```
