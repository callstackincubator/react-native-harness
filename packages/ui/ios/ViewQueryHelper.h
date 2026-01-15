#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Enum defining the types of queries that can be performed on the view hierarchy.
 * Add new query types here to extend functionality.
 */
typedef NS_ENUM(NSInteger, ViewQueryType) {
    ViewQueryTypeTestId,            // Matches accessibilityIdentifier
    ViewQueryTypeAccessibilityLabel // Matches accessibilityLabel
};

/**
 * Represents information about a found view.
 */
@interface ViewQueryResult : NSObject

@property (nonatomic, assign) CGFloat x;
@property (nonatomic, assign) CGFloat y;
@property (nonatomic, assign) CGFloat width;
@property (nonatomic, assign) CGFloat height;

- (NSDictionary *)toDictionary;

@end

/**
 * Helper class for querying the view hierarchy.
 * Provides reusable query logic for finding views by various criteria.
 */
@interface ViewQueryHelper : NSObject

/**
 * Returns the currently active window.
 */
+ (nullable UIWindow *)getActiveWindow;

/**
 * Finds the first view matching the query criteria.
 * @param queryType The type of query to perform.
 * @param value The value to match against.
 * @return ViewQueryResult if found, nil otherwise.
 */
+ (nullable ViewQueryResult *)queryWithType:(ViewQueryType)queryType value:(NSString *)value;

/**
 * Finds all views matching the query criteria.
 * @param queryType The type of query to perform.
 * @param value The value to match against.
 * @return Array of ViewQueryResult objects.
 */
+ (NSArray<ViewQueryResult *> *)queryAllWithType:(ViewQueryType)queryType value:(NSString *)value;

/**
 * Captures a screenshot of the window or a specific region.
 * @param bounds Optional CGRect for capturing a specific region. Pass CGRectNull for full window.
 * @return NSData containing PNG image data, or nil on failure.
 */
+ (nullable NSData *)captureScreenshotWithBounds:(CGRect)bounds;

@end

NS_ASSUME_NONNULL_END
