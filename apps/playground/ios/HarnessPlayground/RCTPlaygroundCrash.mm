#import "RCTPlaygroundCrash.h"
#import "RCTDefaultReactNativeFactoryDelegate.h"
#import "HarnessPlayground-Swift.h"

#import <React/RCTAssert.h>
#import <memory>

using namespace facebook::react;

@implementation RCTPlaygroundCrash {
  PlaygroundSwiftCrash *_swiftCrash;
}

RCT_EXPORT_MODULE(PlaygroundCrash)

- (instancetype)init
{
  if (self = [super init]) {
    _swiftCrash = [PlaygroundSwiftCrash new];
  }
  return self;
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativePlaygroundCrashSpecJSI>(params);
}

- (NSNumber *)crashFromObjectiveCSync:(NSString *)message
{
  @throw [NSException exceptionWithName:@"HarnessPlaygroundObjectiveCCrash"
                                 reason:[NSString stringWithFormat:@"Intentional Objective-C crash: %@", message]
                               userInfo:nil];

  return @NO;
}

- (void)crashFromObjectiveCAsync:(NSString *)message
{
  dispatch_async(dispatch_get_main_queue(), ^{
    @throw [NSException exceptionWithName:@"HarnessPlaygroundObjectiveCCrash"
                                   reason:[NSString stringWithFormat:@"Intentional Objective-C crash: %@", message]
                                 userInfo:nil];
  });
}

- (NSNumber *)crashFromSwiftSync:(NSString *)message
{
  [_swiftCrash crashSyncWithMessage:message];

  return @NO;
}

- (void)crashFromSwiftAsync:(NSString *)message
{
  [_swiftCrash crashAsyncWithMessage:message];
}

- (NSNumber *)crashFromKotlinSync:(NSString *)message
{
  RCTFatal([NSError errorWithDomain:@"HarnessPlaygroundUnsupportedCrash"
                               code:1
                           userInfo:@{
                               NSLocalizedDescriptionKey :
                                   [NSString stringWithFormat:@"Kotlin crash is only available on Android. Requested message: %@", message]
                           }]);

  return @NO;
}

- (void)crashFromKotlinAsync:(NSString *)message
{
  RCTFatal([NSError errorWithDomain:@"HarnessPlaygroundUnsupportedCrash"
                               code:1
                           userInfo:@{
                              NSLocalizedDescriptionKey :
                                  [NSString stringWithFormat:@"Kotlin crash is only available on Android. Requested message: %@", message]
                           }]);
}

@end
