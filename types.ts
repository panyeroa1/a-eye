

export enum AppMode {
  VISION_OS = 'VISION_OS'
}

export enum ChatModelType {
  FAST = 'FAST',
  SMART = 'SMART',
  SEARCH = 'SEARCH',
  MAPS = 'MAPS'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  groundingMetadata?: any;
}

export interface DriveState {
  speed: number;
  heading: number;
  streetName: string;
  isDriving: boolean;
}

export interface NavigationData {
  isActive: boolean;
  destination: string | null;
  direction: 'STRAIGHT' | 'LEFT' | 'RIGHT' | 'UTURN' | 'ARRIVED';
  distance: string;
  instruction: string;
}

export interface HUDCard {
  id: string;
  type: 'SEARCH' | 'MAPS' | 'IMAGE' | 'INFO';
  title: string;
  content: string;
}

// Fixed: Defined AIStudio interface to resolve type mismatch and modifier conflict in global Window augmentation.
export interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
    // Fixed: Marked aistudio as optional and used AIStudio type to match platform environment requirements.
    aistudio?: AIStudio;
  }
}
