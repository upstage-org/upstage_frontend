export interface ObjectProps {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  type: string;
  src?: string;
  url?: string;
  assetType?: { name: string };
  isPlaying?: boolean;
  loop?: boolean;
  multi?: boolean;
  autoplayFrames?: string;
  frames?: string[];
  wornBy?: string;
  holder?: { id: string };
  link?: { url: string; blank?: boolean; effect?: boolean };
  replayed?: boolean;
  [key: string]: any;
}