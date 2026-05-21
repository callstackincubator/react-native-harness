#import "PlaygroundCrash.h"

#import <React/RCTLog.h>

@implementation PlaygroundCrash

- (void)crash:(NSString *)message
{
  NSString *reason =
      message.length > 0 ? message : @"Intentional PlaygroundCrash crash";
  RCTLogInfo(@"[PlaygroundCrash] %@", reason);

  NSThread *thread = [[NSThread alloc] initWithBlock:^{
    @throw [NSException exceptionWithName:@"PlaygroundCrash"
                                    reason:reason
                                  userInfo:nil];
  }];
  thread.name = @"PlaygroundCrash";
  [thread start];

  [NSThread sleepForTimeInterval:10.0];
}

- (NSNumber *)crashHandled:(NSString *)message
{
  NSString *reason = message.length > 0
      ? message
      : @"Intentional PlaygroundCrash handled error";
  RCTLogInfo(@"[PlaygroundCrash] handled %@", reason);

  @throw [NSException exceptionWithName:@"PlaygroundCrash"
                                  reason:reason
                                userInfo:nil];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativePlaygroundCrashSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"PlaygroundCrash";
}

@end
