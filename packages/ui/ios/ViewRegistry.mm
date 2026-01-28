#import "ViewRegistry.h"

@implementation ViewRegistry

+ (NSMapTable<NSString *, UIView *> *)registry {
    static NSMapTable *registry = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // Key: Strong (NSString), Value: Weak (UIView)
        // When UIView is deallocated, it is automatically removed from the map.
        registry = [NSMapTable strongToWeakObjectsMapTable];
    });
    return registry;
}

+ (NSString *)registerView:(UIView *)view {
    if (!view) return nil;
    
    // Generate a unique ID. Using a random UUID ensures freshness for each query.
    NSString *nativeId = [[NSUUID UUID] UUIDString];
    
    // Store in registry
    [[self registry] setObject:view forKey:nativeId];
    
    return nativeId;
}

+ (UIView *)getView:(NSString *)nativeId {
    if (!nativeId) return nil;
    return [[self registry] objectForKey:nativeId];
}

@end
