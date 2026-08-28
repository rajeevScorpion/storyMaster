# Phase 1C — MP4 Compatibility Fix

Goal: Export a final MP4 that opens in native media players/VLC/mobile browsers and uploads directly to YouTube/Instagram without unsupported-format errors.

Current symptom:

- Downloaded MP4 does not play reliably in native players or VLC.
- YouTube rejects direct upload as unsupported.
- WhatsApp plays it after sending/uploading, likely because WhatsApp transcodes or rewrites the container.

Treat this as a release blocker.

## Target final output

For final downloadable MP4, prefer:

```txt
Container: MP4
Video codec: H.264 / AVC
Audio codec: AAC-LC
Audio sample rate: 48 kHz
Audio channels: stereo if possible
Frame rate: constant 30 fps for SD/HD default
Video: progressive scan
Chroma: 4:2:0 where configurable/possible
MP4 Fast Start / moov atom at front: enabled
Fragmented MP4: disabled for final download unless proven compatible
No edit lists if configurable
Clean monotonic PTS/DTS timestamps
```

## Mediabunny output format checks

Inspect the current Mediabunny output format configuration.

Specifically check:

- Is the output a regular MP4 or fragmented MP4/fMP4?
- Is `fastStart` enabled or available?
- Is metadata written at the beginning of the file?
- Is the output finalized correctly before download?
- Are audio and video track timestamps aligned?
- Are track durations correct?
- Is the MIME type and filename extension correct?

Final user download should not use a streaming-oriented fragmented format unless testing proves it works across VLC, native players, YouTube, and Instagram.

## Codec configuration

Use safe codec/profile options based on browser support.

Suggested practical defaults to test:

```ts
const videoCodecCandidates = [
  'avc1.42E01E', // H.264 baseline-ish, broad compatibility
  'avc1.4D401F', // H.264 main-ish
  'avc1.640028', // H.264 high-ish for HD if supported
];
```

Do not blindly force a codec string. Use support detection:

```ts
await VideoEncoder.isConfigSupported({
  codec,
  width,
  height,
  bitrate,
  framerate: fps,
  hardwareAcceleration: 'prefer-hardware',
  latencyMode: 'quality'
});
```

If a profile fails, fall back to a safer profile.

## Audio checks

Inspect narration/audio handling.

Check:

- AAC-LC output if available.
- 48 kHz sample rate target.
- No missing audio track metadata.
- No negative or offset timestamps.
- Audio duration and visual duration alignment.
- If visual duration is longer than narration, fill/silence/hold correctly.
- If narration is longer than visual timeline, extend visuals or handle timeline duration consistently.

## Validation commands

Ask the developer to validate sample exports using:

```bash
ffprobe -hide_banner -show_format -show_streams kissago_sd.mp4
ffmpeg -v error -i kissago_sd.mp4 -f null -
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_tag_string,profile,width,height,r_frame_rate,avg_frame_rate,pix_fmt -of default=nw=1 kissago_sd.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,profile,sample_rate,channels,bit_rate -of default=nw=1 kissago_sd.mp4
```

Expected broad result:

```txt
Video codec: h264
Audio codec: aac
Container: mov/mp4/m4a/3gp/3g2/mj2
Pixel format: yuv420p or browser-compatible equivalent if reported
Frame rate: constant 30/1 or close
No decode errors
No non-monotonic timestamp errors
```

## Platform test matrix

Test at least:

```txt
Chrome desktop playback
Chrome Android playback
Native Android video player
VLC desktop/mobile
YouTube upload
Instagram/Reels upload if available
WhatsApp share after fix, but do not use WhatsApp as the main proof because it may transcode
```

## Acceptance for compatibility

- Downloaded file opens directly in VLC and native player.
- YouTube accepts direct upload and starts processing.
- Audio plays correctly.
- Text overlay remains synced.
- No major timestamp/decode errors in ffmpeg/ffprobe.
- File extension and MIME type are correct.
