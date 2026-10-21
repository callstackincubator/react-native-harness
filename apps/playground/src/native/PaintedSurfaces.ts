import { requireNativeComponent } from 'react-native';
import type { ViewProps } from 'react-native';

// Android only: see PaintedSurfacesPackage.kt.
export const SolidColorTextureView = requireNativeComponent<ViewProps>(
  'SolidColorTextureView'
);

export const SolidColorSurfaceView = requireNativeComponent<ViewProps>(
  'SolidColorSurfaceView'
);

export const SplitColorSurfaceView = requireNativeComponent<ViewProps>(
  'SplitColorSurfaceView'
);

export const SplitColorVideoView = requireNativeComponent<ViewProps>(
  'SplitColorVideoView'
);

export const RootShiftView = requireNativeComponent<
  ViewProps & { rootTranslationY: number }
>('RootShiftView');
