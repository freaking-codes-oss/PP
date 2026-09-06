import { PlatformId } from './index';

// ---------------------------------------------------------------------------
// Per-platform format constraints + caption rules (used by format adapters,
// Stage 5 metadata generation and the publishing queue).
// ---------------------------------------------------------------------------

export interface PlatformFormatSpec {
  platform: PlatformId;
  label: string;
  // video constraints for the short-form vertical use case
  recommendedAspect: '9:16' | '16:9' | '1:1';
  maxDurationSec: number;
  maxFileSizeMb: number;
  captionMaxLength: number;
  captionStyleHint: string;
  // supported by our publish adapters
  supportsDraft: boolean;
}

export const PLATFORM_FORMATS: Record<PlatformId, PlatformFormatSpec> = {
  [PlatformId.YOUTUBE]: {
    platform: PlatformId.YOUTUBE,
    label: 'YouTube (Shorts)',
    recommendedAspect: '9:16',
    maxDurationSec: 180,
    maxFileSizeMb: 256,
    captionMaxLength: 5000,
    captionStyleHint: 'title up to 100 chars; description 2-3 lines + up to 15 hashtags',
    supportsDraft: true,
  },
  [PlatformId.TIKTOK]: {
    platform: PlatformId.TIKTOK,
    label: 'TikTok',
    recommendedAspect: '9:16',
    maxDurationSec: 600,
    maxFileSizeMb: 512,
    captionMaxLength: 2200,
    captionStyleHint: 'one hook line + 3-5 hashtags',
    supportsDraft: false,
  },
  [PlatformId.FACEBOOK]: {
    platform: PlatformId.FACEBOOK,
    label: 'Facebook (Reels)',
    recommendedAspect: '9:16',
    maxDurationSec: 90,
    maxFileSizeMb: 4096,
    captionMaxLength: 63206,
    captionStyleHint: 'short description + hashtags',
    supportsDraft: true,
  },
  [PlatformId.INSTAGRAM]: {
    platform: PlatformId.INSTAGRAM,
    label: 'Instagram (Reels)',
    recommendedAspect: '9:16',
    maxDurationSec: 90,
    maxFileSizeMb: 4096,
    captionMaxLength: 2200,
    captionStyleHint: 'hook + 3-5 hashtags',
    supportsDraft: false,
  },
};

export const SHORTFORM_TARGET_DURATION_SEC = 30;
export const SHORTFORM_TARGET_RESOLUTION = { width: 1080, height: 1920 };

export interface CaptionSegment {
  text: string;
  startSec: number;
  endSec: number;
}
