// ObjC boot hook — Swift has no +load equivalent, so this bridges to HarnessCoverageHelper.setup().
#import <Foundation/Foundation.h>

@interface HarnessCoverageSetup : NSObject
@end

@implementation HarnessCoverageSetup

+ (void)load {
#if defined(HARNESS_COVERAGE)
  dispatch_async(dispatch_get_main_queue(), ^{
    Class helper = NSClassFromString(@"HarnessCoverageHelper");
    if (helper) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wundeclared-selector"
      [helper performSelector:@selector(setup)];
#pragma clang diagnostic pop
    } else {
      NSLog(@"[HarnessCoverage] ERROR: HarnessCoverageHelper class not found");
    }
  });
#endif
}

@end
