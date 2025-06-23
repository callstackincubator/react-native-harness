export class UIInteractionDisabledError extends Error {
    constructor(operation: string) {
        super(
            `UI interaction "${operation}" attempted but UI testing is disabled. ` +
            `Set "withUI: true" in your runner configuration to enable UI interactions.`
        );
        this.name = 'UIInteractionDisabledError';
    }
} 