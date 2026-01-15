#import "ViewQueryHelper.h"

// =============================================================================
// ViewQueryResult Implementation
// =============================================================================

@implementation ViewQueryResult

- (NSDictionary *)toDictionary {
    return @{
        @"x": @(self.x),
        @"y": @(self.y),
        @"width": @(self.width),
        @"height": @(self.height)
    };
}

@end

// =============================================================================
// ViewQueryHelper Implementation
// =============================================================================

@implementation ViewQueryHelper

#pragma mark - Window Access

+ (nullable UIWindow *)getActiveWindow {
    UIWindow *window = nil;
    if (@available(iOS 13.0, *)) {
        for (UIWindowScene *scene in [UIApplication sharedApplication].connectedScenes) {
            if (scene.activationState == UISceneActivationStateForegroundActive) {
                for (UIWindow *w in scene.windows) {
                    if (w.isKeyWindow) {
                        window = w;
                        break;
                    }
                }
                if (!window) {
                    window = scene.windows.firstObject;
                }
                break;
            }
        }
    } else {
        window = [UIApplication sharedApplication].keyWindow;
    }
    return window;
}

#pragma mark - View Matching

/**
 * Checks if a view matches the given query criteria.
 * Add new query type matching logic here.
 */
+ (BOOL)view:(UIView *)view matchesQueryType:(ViewQueryType)queryType value:(NSString *)value {
    switch (queryType) {
        case ViewQueryTypeTestId:
            return [view.accessibilityIdentifier isEqualToString:value];

        case ViewQueryTypeAccessibilityLabel:
            return [view.accessibilityLabel isEqualToString:value];

        // Add new query types here:
        // case ViewQueryTypeNewType:
        //     return [view.someProperty isEqualToString:value];
    }
    return NO;
}

#pragma mark - View Traversal

/**
 * Recursively finds the first view matching the query criteria.
 */
+ (nullable UIView *)findViewInView:(UIView *)view
                          queryType:(ViewQueryType)queryType
                              value:(NSString *)value {
    if ([self view:view matchesQueryType:queryType value:value]) {
        return view;
    }

    for (UIView *subview in view.subviews) {
        UIView *found = [self findViewInView:subview queryType:queryType value:value];
        if (found) {
            return found;
        }
    }
    return nil;
}

/**
 * Recursively finds all views matching the query criteria.
 */
+ (void)findAllViewsInView:(UIView *)view
                 queryType:(ViewQueryType)queryType
                     value:(NSString *)value
                   results:(NSMutableArray<UIView *> *)results {
    if ([self view:view matchesQueryType:queryType value:value]) {
        [results addObject:view];
    }

    for (UIView *subview in view.subviews) {
        [self findAllViewsInView:subview queryType:queryType value:value results:results];
    }
}

#pragma mark - Result Conversion

/**
 * Converts a UIView to a ViewQueryResult with screen coordinates.
 */
+ (ViewQueryResult *)resultFromView:(UIView *)view window:(UIWindow *)window {
    CGRect frameInWindow = [view convertRect:view.bounds toView:window];

    ViewQueryResult *result = [[ViewQueryResult alloc] init];
    result.x = frameInWindow.origin.x;
    result.y = frameInWindow.origin.y;
    result.width = frameInWindow.size.width;
    result.height = frameInWindow.size.height;
    return result;
}

#pragma mark - Public Query API

+ (nullable ViewQueryResult *)queryWithType:(ViewQueryType)queryType value:(NSString *)value {
    UIWindow *window = [self getActiveWindow];
    if (!window) {
        return nil;
    }

    UIView *found = [self findViewInView:window queryType:queryType value:value];
    if (!found) {
        return nil;
    }

    return [self resultFromView:found window:window];
}

+ (NSArray<ViewQueryResult *> *)queryAllWithType:(ViewQueryType)queryType value:(NSString *)value {
    UIWindow *window = [self getActiveWindow];
    if (!window) {
        return @[];
    }

    NSMutableArray<UIView *> *views = [NSMutableArray array];
    [self findAllViewsInView:window queryType:queryType value:value results:views];

    NSMutableArray<ViewQueryResult *> *results = [NSMutableArray arrayWithCapacity:views.count];
    for (UIView *view in views) {
        [results addObject:[self resultFromView:view window:window]];
    }
    return results;
}

#pragma mark - Screenshot Capture

+ (nullable NSData *)captureScreenshotWithBounds:(CGRect)bounds {
    UIWindow *window = [self getActiveWindow];
    if (!window) {
        return nil;
    }

    // Determine capture rect
    CGRect captureRect = CGRectIsNull(bounds) ? window.bounds : bounds;

    // Use UIGraphicsImageRenderer for modern, efficient rendering
    UIGraphicsImageRendererFormat *format = [[UIGraphicsImageRendererFormat alloc] init];
    format.scale = [UIScreen mainScreen].scale;
    format.opaque = YES;

    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:captureRect.size format:format];

    UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
        // Translate to capture the correct region
        CGContextTranslateCTM(context.CGContext, -captureRect.origin.x, -captureRect.origin.y);

        // Draw the window hierarchy
        [window drawViewHierarchyInRect:window.bounds afterScreenUpdates:YES];
    }];

    // Convert to PNG
    return UIImagePNGRepresentation(image);
}

@end
