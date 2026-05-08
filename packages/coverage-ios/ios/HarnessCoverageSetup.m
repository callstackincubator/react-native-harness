#import <Foundation/Foundation.h>

@interface HarnessCoverageSetup : NSObject
@end

@implementation HarnessCoverageSetup

+ (void)load {
#if defined(HARNESS_COVERAGE)
  NSLog(@"[HarnessCoverage] +load called, HARNESS_COVERAGE is defined");
  dispatch_async(dispatch_get_main_queue(), ^{
    Class helper = NSClassFromString(@"HarnessCoverageHelper");
    if (helper) {
      NSLog(@"[HarnessCoverage] Found HarnessCoverageHelper, calling setup");
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wundeclared-selector"
      [helper performSelector:@selector(setup)];
#pragma clang diagnostic pop
    } else {
      NSLog(@"[HarnessCoverage] ERROR: HarnessCoverageHelper class not found");
    }
  });
#else
  NSLog(@"[HarnessCoverage] +load called but HARNESS_COVERAGE is NOT defined");
#endif
}

@end
