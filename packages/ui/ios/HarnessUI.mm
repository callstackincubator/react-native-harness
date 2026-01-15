#import "HarnessUI.h"
#import "ViewQueryHelper.h"
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

// Private UITouch methods for touch synthesis
@interface UITouch (Synthesis)
- (void)setPhase:(UITouchPhase)phase;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setIsTap:(BOOL)isTap;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)reset;
- (void)_setIsFirstTouchForView:(BOOL)first;
- (void)_setTouchIdentifier:(unsigned int)identifier;
@end

// Private UIEvent methods for event synthesis
@interface UIEvent (Synthesis)
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_clearTouches;
- (void)_setTimestamp:(NSTimeInterval)timestamp;
- (void)_setHIDEvent:(void *)event;
@end

// Private UIApplication method for event synthesis
@interface UIApplication (Synthesis)
- (UIEvent *)_touchesEvent;
@end

// Configuration constants
static const int kMaxRetryCount =
    10; // Maximum retries waiting for active touches
static const NSTimeInterval kRetryInterval = 0.05; // 50ms between retries
static const NSTimeInterval kSettleDelay =
    0.01; // 10ms delay for system to settle
static const NSTimeInterval kTapDuration =
    0.05; // 50ms between touch began and ended
static const NSTimeInterval kEventProcessingDelay =
    0.01; // 10ms delay after touch ended for React Native to process the event
static const NSTimeInterval kMinTapInterval =
    0.15; // 150ms minimum between taps

static unsigned int _touchIdCounter = 100;
static NSTimeInterval _lastTapTime = 0;

@implementation HarnessUI

#pragma mark - Window Access

- (UIWindow *)getActiveWindow {
  return [ViewQueryHelper getActiveWindow];
}

#pragma mark - Touch Synthesis

- (void)sendTouchEvent:(UITouch *)touch
                 event:(UIEvent *)event
                 phase:(UITouchPhase)phase
                 point:(CGPoint)point {
  NSTimeInterval timestamp = [[NSProcessInfo processInfo] systemUptime];
  
  NSString *phaseName;
  switch (phase) {
    case UITouchPhaseBegan:
      phaseName = @"began";
      break;
    case UITouchPhaseMoved:
      phaseName = @"moved";
      break;
    case UITouchPhaseStationary:
      phaseName = @"stationary";
      break;
    case UITouchPhaseEnded:
      phaseName = @"ended";
      break;
    case UITouchPhaseCancelled:
      phaseName = @"cancelled";
      break;
    default:
      phaseName = @"unknown";
  }
  RCTLogInfo(@"[HarnessUI] Sending touch event: phase=%@ point=(%.2f, %.2f)", 
             phaseName, point.x, point.y);

  [touch setPhase:phase];
  [touch setTimestamp:timestamp];
  [touch _setLocationInWindow:point resetPrevious:(phase == UITouchPhaseBegan)];

  [event _clearTouches];
  [event _addTouch:touch forDelayedDelivery:NO];
  [event _setTimestamp:timestamp];

  [[UIApplication sharedApplication] sendEvent:event];
}

- (BOOL)hasActiveTouches:(UIWindow *)window {
  // Check if there are any active touches on the window
  UIEvent *event = [[UIApplication sharedApplication] _touchesEvent];
  NSSet *allTouches = [event allTouches];

  for (UITouch *touch in allTouches) {
    UITouchPhase phase = touch.phase;
    if (phase == UITouchPhaseBegan || phase == UITouchPhaseMoved ||
        phase == UITouchPhaseStationary) {
      RCTLogInfo(@"[HarnessUI] Found active touch in phase %ld", (long)phase);
      return YES;
    }
  }
  return NO;
}

- (void)executeTapAtPoint:(CGPoint)point
               retryCount:(int)retryCount
               completion:(void (^)(void))completion {
  UIWindow *window = [self getActiveWindow];
  if (!window) {
    RCTLogInfo(@"[HarnessUI] No active window found");
    if (completion)
      completion();
    return;
  }

  // Check for active real touches - wait for them to finish
  if ([self hasActiveTouches:window]) {
    if (retryCount < kMaxRetryCount) {
      RCTLogInfo(@"[HarnessUI] Active touches detected, waiting... (retry %d)",
                 retryCount);
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                   (int64_t)(kRetryInterval * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), ^{
                       [self executeTapAtPoint:point
                                    retryCount:retryCount + 1
                                    completion:completion];
                     });
      return;
    } else {
      RCTLogInfo(
          @"[HarnessUI] Timeout waiting for touches to end, proceeding anyway");
    }
  }

  UIView *targetView = [window hitTest:point withEvent:nil];
  if (!targetView) {
    RCTLogInfo(@"[HarnessUI] No view at point (%.2f, %.2f)", point.x, point.y);
    if (completion)
      completion();
    return;
  }

  RCTLogInfo(@"[HarnessUI] Target view: %@", targetView);

  // Get the internal touches event from UIApplication
  UIEvent *event = [[UIApplication sharedApplication] _touchesEvent];

  // Aggressively clear all existing state
  [event _clearTouches];
  if ([event respondsToSelector:@selector(_setHIDEvent:)]) {
    [event _setHIDEvent:NULL];
  }

  // Small delay after clearing to let the system settle
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSettleDelay * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        // Create fresh touch with unique identifier (handle overflow)
        UITouch *touch = [[UITouch alloc] init];
        _touchIdCounter =
            (_touchIdCounter >= UINT_MAX - 1) ? 100 : _touchIdCounter + 1;
        unsigned int touchId = _touchIdCounter;

        if ([touch respondsToSelector:@selector(_setTouchIdentifier:)]) {
          [touch _setTouchIdentifier:touchId];
        }

        // Configure touch
        [touch setWindow:window];
        [touch setView:targetView];
        [touch setTapCount:1];
        if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) {
          [touch _setIsFirstTouchForView:YES];
        }
        if ([touch respondsToSelector:@selector(setIsTap:)]) {
          [touch setIsTap:YES];
        }

        // Re-fetch event (in case it changed) and clear again
        UIEvent *freshEvent = [[UIApplication sharedApplication] _touchesEvent];
        [freshEvent _clearTouches];

        // Send began
        [self sendTouchEvent:touch
                       event:freshEvent
                       phase:UITouchPhaseBegan
                       point:point];
        RCTLogInfo(@"[HarnessUI] Sent touch began (id=%u)", touchId);

        // Schedule ended phase - re-fetch event to avoid race condition with
        // real touches
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW,
                          (int64_t)(kTapDuration * NSEC_PER_SEC)),
            dispatch_get_main_queue(), ^{
              UIEvent *endEvent =
                  [[UIApplication sharedApplication] _touchesEvent];
              [self sendTouchEvent:touch
                             event:endEvent
                             phase:UITouchPhaseEnded
                             point:point];
              [endEvent _clearTouches];
              RCTLogInfo(@"[HarnessUI] Tap completed (id=%u)", touchId);
              // Wait for React Native to process the touch event
              // and trigger JS callbacks before resolving
              dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                           (int64_t)(kEventProcessingDelay *
                                                     NSEC_PER_SEC)),
                             dispatch_get_main_queue(), ^{
                               if (completion)
                                 completion();
                             });
            });
      });
}

- (void)executeTapAtPoint:(CGPoint)point completion:(void (^)(void))completion {
  [self executeTapAtPoint:point retryCount:0 completion:completion];
}

- (void)simulatePress:(double)x
                  y:(double)y
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
  RCTLogInfo(@"[HarnessUI] simulatePress called with x:%.2f y:%.2f", x, y);

  dispatch_async(dispatch_get_main_queue(), ^{
    NSTimeInterval now = CACurrentMediaTime();
    NSTimeInterval timeSinceLastTap = now - _lastTapTime;
    CGPoint point = CGPointMake(x, y);

    // Completion block that actually resolves the promise
    void (^completionBlock)(void) = ^{
      // Check if tap was successful by verifying we found a window/view
      UIWindow *window = [self getActiveWindow];
      if (!window) {
        reject(@"NO_WINDOW", @"No active window found", nil);
        return;
      }

      UIView *targetView = [window hitTest:point withEvent:nil];
      if (!targetView) {
        reject(
            @"NO_VIEW",
            [NSString
                stringWithFormat:@"No view found at point (%.2f, %.2f)", x, y],
            nil);
        return;
      }

      // Success - resolve with success info
      resolve(@{@"success" : @YES, @"x" : @(x), @"y" : @(y)});
    };

    if (timeSinceLastTap < kMinTapInterval) {
      NSTimeInterval delay = kMinTapInterval - timeSinceLastTap;
      RCTLogInfo(@"[HarnessUI] Delaying tap by %.0fms", delay * 1000);
      _lastTapTime = now + delay;

      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)),
          dispatch_get_main_queue(), ^{
            [self executeTapAtPoint:point completion:completionBlock];
          });
    } else {
      _lastTapTime = now;
      [self executeTapAtPoint:point completion:completionBlock];
    }
  });
}

#pragma mark - Query API

- (NSDictionary *)queryByTestId:(NSString *)testId {
  RCTLogInfo(@"[HarnessUI] queryByTestId called with: %@", testId);

  __block NSDictionary *result = nil;

  if ([NSThread isMainThread]) {
    ViewQueryResult *queryResult =
        [ViewQueryHelper queryWithType:ViewQueryTypeTestId value:testId];
    result = queryResult ? [queryResult toDictionary] : nil;
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      ViewQueryResult *queryResult =
          [ViewQueryHelper queryWithType:ViewQueryTypeTestId value:testId];
      result = queryResult ? [queryResult toDictionary] : nil;
    });
  }

  RCTLogInfo(@"[HarnessUI] queryByTestId result: %@", result);
  return result;
}

- (NSDictionary *)queryByAccessibilityLabel:(NSString *)label {
  RCTLogInfo(@"[HarnessUI] queryByAccessibilityLabel called with: %@", label);

  __block NSDictionary *result = nil;

  if ([NSThread isMainThread]) {
    ViewQueryResult *queryResult =
        [ViewQueryHelper queryWithType:ViewQueryTypeAccessibilityLabel
                                 value:label];
    result = queryResult ? [queryResult toDictionary] : nil;
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      ViewQueryResult *queryResult =
          [ViewQueryHelper queryWithType:ViewQueryTypeAccessibilityLabel
                                   value:label];
      result = queryResult ? [queryResult toDictionary] : nil;
    });
  }

  RCTLogInfo(@"[HarnessUI] queryByAccessibilityLabel result: %@", result);
  return result;
}

- (NSArray<NSDictionary *> *)queryAllByTestId:(NSString *)testId {
  RCTLogInfo(@"[HarnessUI] queryAllByTestId called with: %@", testId);

  __block NSArray<NSDictionary *> *result = @[];

  if ([NSThread isMainThread]) {
    NSArray<ViewQueryResult *> *queryResults =
        [ViewQueryHelper queryAllWithType:ViewQueryTypeTestId value:testId];
    NSMutableArray<NSDictionary *> *dicts =
        [NSMutableArray arrayWithCapacity:queryResults.count];
    for (ViewQueryResult *queryResult in queryResults) {
      [dicts addObject:[queryResult toDictionary]];
    }
    result = dicts;
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      NSArray<ViewQueryResult *> *queryResults =
          [ViewQueryHelper queryAllWithType:ViewQueryTypeTestId value:testId];
      NSMutableArray<NSDictionary *> *dicts =
          [NSMutableArray arrayWithCapacity:queryResults.count];
      for (ViewQueryResult *queryResult in queryResults) {
        [dicts addObject:[queryResult toDictionary]];
      }
      result = dicts;
    });
  }

  RCTLogInfo(@"[HarnessUI] queryAllByTestId result count: %lu",
             (unsigned long)result.count);
  return result;
}

- (NSArray<NSDictionary *> *)queryAllByAccessibilityLabel:(NSString *)label {
  RCTLogInfo(@"[HarnessUI] queryAllByAccessibilityLabel called with: %@", label);

  __block NSArray<NSDictionary *> *result = @[];

  if ([NSThread isMainThread]) {
    NSArray<ViewQueryResult *> *queryResults =
        [ViewQueryHelper queryAllWithType:ViewQueryTypeAccessibilityLabel
                                    value:label];
    NSMutableArray<NSDictionary *> *dicts =
        [NSMutableArray arrayWithCapacity:queryResults.count];
    for (ViewQueryResult *queryResult in queryResults) {
      [dicts addObject:[queryResult toDictionary]];
    }
    result = dicts;
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      NSArray<ViewQueryResult *> *queryResults =
          [ViewQueryHelper queryAllWithType:ViewQueryTypeAccessibilityLabel
                                      value:label];
      NSMutableArray<NSDictionary *> *dicts =
          [NSMutableArray arrayWithCapacity:queryResults.count];
      for (ViewQueryResult *queryResult in queryResults) {
        [dicts addObject:[queryResult toDictionary]];
      }
      result = dicts;
    });
  }

  RCTLogInfo(@"[HarnessUI] queryAllByAccessibilityLabel result count: %lu",
             (unsigned long)result.count);
  return result;
}

#pragma mark - Screenshot API

- (void)captureScreenshot:(JS::NativeHarnessUI::ViewInfo *)bounds
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  RCTLogInfo(@"[HarnessUI] captureScreenshot called");

  CGRect captureRect = CGRectNull;

  if (bounds) {
    double width = bounds->width();
    double height = bounds->height();

    if (width > 0 && height > 0) {
      captureRect = CGRectMake(bounds->x(), bounds->y(), width, height);
      RCTLogInfo(@"[HarnessUI] Capturing region: x=%.2f y=%.2f w=%.2f h=%.2f",
                 captureRect.origin.x, captureRect.origin.y,
                 captureRect.size.width, captureRect.size.height);
    }
  } else {
    RCTLogInfo(@"[HarnessUI] Capturing full window");
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    NSData *pngData = [ViewQueryHelper captureScreenshotWithBounds:captureRect];

    if (pngData) {
      // Return Base64 string for efficiency
      NSString *base64String = [pngData base64EncodedStringWithOptions:0];
      RCTLogInfo(@"[HarnessUI] Screenshot captured successfully (%lu bytes)",
                 (unsigned long)pngData.length);
      resolve(base64String);
    } else {
      RCTLogInfo(@"[HarnessUI] Screenshot capture returned nil");
      resolve([NSNull null]);
    }
  });
}

#pragma mark - Text Input

- (UIResponder *)findFirstResponderInView:(UIView *)view {
  if ([view isFirstResponder]) {
    return view;
  }
  for (UIView *subview in view.subviews) {
    UIResponder *responder = [self findFirstResponderInView:subview];
    if (responder) {
      return responder;
    }
  }
  return nil;
}

- (void)typeChar:(NSString *)character
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  RCTLogInfo(@"[HarnessUI] typeChar called with: %@", character);

  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = [self getActiveWindow];
    UIResponder *firstResponder = [self findFirstResponderInView:window];

    if ([firstResponder conformsToProtocol:@protocol(UITextInput)]) {
      id<UITextInput> textInput = (id<UITextInput>)firstResponder;
      [textInput insertText:character];
      RCTLogInfo(@"[HarnessUI] Inserted character: %@", character);
    } else {
      RCTLogInfo(@"[HarnessUI] No text input is focused");
    }

    // Small delay for React Native to process the change event
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                 (int64_t)(kEventProcessingDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     resolve(nil);
                   });
  });
}

- (void)blur:(JS::NativeHarnessUI::SpecBlurOptions &)options
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject {
  RCTLogInfo(@"[HarnessUI] blur called");

  // Extract value before async dispatch to avoid dangling reference
  BOOL shouldSubmitEditing = options.submitEditing().value_or(false);

  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = [self getActiveWindow];
    UIResponder *firstResponder = [self findFirstResponderInView:window];

    if (firstResponder) {
      if (shouldSubmitEditing) {
        RCTLogInfo(@"[HarnessUI] Triggering submitEditing");
        // Trigger submitEditing event if the responder supports it
        // For UITextField, this simulates pressing Return
        if ([firstResponder isKindOfClass:[UITextField class]]) {
          UITextField *textField = (UITextField *)firstResponder;
          [textField.delegate textFieldShouldReturn:textField];
        }
      }

      // Resign first responder (triggers endEditing and blur events)
      RCTLogInfo(@"[HarnessUI] Resigning first responder");
      [firstResponder resignFirstResponder];
    } else {
      RCTLogInfo(@"[HarnessUI] No first responder found");
    }

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                 (int64_t)(kEventProcessingDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     resolve(nil);
                   });
  });
}

#pragma mark - TurboModule plumbing

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeHarnessUISpecJSI>(params);
}

+ (NSString *)moduleName {
  return @"HarnessUI";
}

@end
