#import <UIKit/UIKit.h>

@interface ViewRegistry : NSObject

+ (NSString *)registerView:(UIView *)view;
+ (UIView *)getView:(NSString *)nativeId;

@end
