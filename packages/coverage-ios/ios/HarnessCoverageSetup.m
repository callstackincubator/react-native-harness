#if defined(HARNESS_COVERAGE)
#import <Foundation/Foundation.h>

@interface HarnessCoverageSetup : NSObject
@end

@implementation HarnessCoverageSetup

+ (void)load {
  Class helper = NSClassFromString(@"HarnessCoverageHelper");
  if (helper) {
    #pragma clang diagnostic push
    #pragma clang diagnostic ignored "-Wundeclared-selector"
    [helper performSelector:@selector(setup)];
    #pragma clang diagnostic pop
  }
}

@end
#endif
