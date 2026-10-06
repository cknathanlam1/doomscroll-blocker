/**
 * Spec S1, "Camera is off", and its siblings: what to say for each way the
 * camera can fail, with the exact taps to fix it on iPhone Safari, or the
 * exact clicks in Chrome/Edge on a Windows laptop.
 */
import type { CameraErrorKind } from '../platform/camera';
import type { Device } from './device';

export interface CameraErrorCopy {
  title: string;
  body: string;
  /** Numbered fix-it steps. */
  steps: string[];
  /** Optional extra line under the steps. */
  note: string;
}

/** iPhone Safari. */
const COPY: Record<CameraErrorKind, CameraErrorCopy> = {
  denied: {
    title: 'Camera is off',
    body: 'We need it to count your reps. Video stays on this iPhone and is never saved.',
    steps: [
      'In Safari, tap the page menu button at the left of the address bar (older iOS: aA)',
      'Tap Website Settings (on newer iOS it is under More)',
      'Set Camera to Allow, then tap Try again below',
    ],
    note: 'Still blocked? Settings › Apps › Safari › Camera › Allow',
  },
  insecure: {
    title: 'Open the https:// address',
    body: 'The camera only works on secure pages, and this one was opened with http://.',
    steps: [
      'On your PC, find the line "Network: https://…:5173" printed by npm run dev',
      'Type that exact address (with https:// and :5173) into Safari',
      'If Safari warns the connection is not private, tap Show Details › visit this website',
    ],
    note: '',
  },
  notFound: {
    title: 'No camera found',
    body: "This device didn't report a front camera we can use.",
    steps: [
      'On a computer, plug in or enable a webcam, then tap Try again',
      'Or go Back and use "Test with a video file"',
    ],
    note: '',
  },
  inUse: {
    title: 'Camera is busy',
    body: 'Another app or tab is using the camera right now.',
    steps: [
      'Close the Camera app, FaceTime, or other Safari tabs that use the camera',
      'Then tap Try again',
    ],
    note: '',
  },
  unsupported: {
    title: "Camera isn't available here",
    body: "This browser doesn't let web pages use the camera.",
    steps: ['Open this page in Safari on the iPhone (iOS 16.4 or newer)', 'Or go Back and use "Test with a video file"'],
    note: '',
  },
  unknown: {
    title: "Camera didn't start",
    body: 'Something went wrong while turning the camera on.',
    steps: ['Tap Try again', 'If it keeps failing, close this Safari tab and open the page again'],
    note: '',
  },
};

/** Chrome / Edge on a laptop (Windows first: that's where this prototype is tested). */
const DESKTOP_COPY: Record<CameraErrorKind, CameraErrorCopy> = {
  denied: {
    title: 'Camera is off',
    body: 'We need it to count your reps. Video stays on this computer and is never saved.',
    steps: [
      'Click the blocked camera icon (camera with a red ✕) at the right end of the address bar, or the site settings icon at its left',
      'Set Camera to Allow',
      'Click Try again below',
    ],
    note: 'Still blocked? Windows Settings › Privacy & security › Camera: turn on camera access, including for desktop apps.',
  },
  insecure: {
    title: 'Open the localhost address',
    body: 'The camera only works on secure pages. On this computer that means http://localhost, or an https:// address.',
    steps: [
      'Run npm.cmd run dev:laptop in the project folder',
      'Open http://localhost:5173 in Chrome or Edge',
    ],
    note: '',
  },
  notFound: {
    title: 'No camera found',
    body: "This computer didn't report a camera we can use.",
    steps: [
      'Check the webcam is on: some laptops have a camera key or a privacy shutter',
      'Then click Try again',
      'Or go Back and use "Watch a demo" or "Test with a video file"',
    ],
    note: '',
  },
  inUse: {
    title: 'Camera is busy',
    body: 'Another app or tab is using the camera right now.',
    steps: ['Close Teams, Zoom, the Camera app, or other tabs that use the camera', 'Then click Try again'],
    note: '',
  },
  unsupported: {
    title: "Camera isn't available here",
    body: "This browser doesn't let web pages use the camera.",
    steps: ['Open this page in Chrome or Edge', 'Or go Back and use "Watch a demo" or "Test with a video file"'],
    note: '',
  },
  unknown: {
    title: "Camera didn't start",
    body: 'Something went wrong while turning the camera on.',
    steps: ['Click Try again', 'If it keeps failing, close this tab and open the page again'],
    note: '',
  },
};

/** The copy for one kind of camera failure, in the words of the device in use. */
export function cameraErrorCopy(kind: CameraErrorKind, device: Device = 'phone'): CameraErrorCopy {
  return device === 'desktop' ? DESKTOP_COPY[kind] : COPY[kind];
}
