import React from 'react';
import { describe, it, expect, render, screen } from '@react-native-harness/runtime';
import { View } from 'react-native';

describe('withUI', () => {
    it('should demonstrate UI interaction capability', async () => {
        try {
            await render(<View testID='testId' />);
            await screen.findByTestId('testId');
        } catch (error) {
            if (error.name === 'UIInteractionDisabledError') {
                // This is expected behavior for withUI: false runners
                expect(error.message).to.contain('Set "withUI: true"');
            } else {
                throw error; // Re-throw unexpected errors
            }
        }
    });

    it('should work for native module testing without UI', () => {
        // This test should work regardless of withUI setting
        // as it doesn't use any interaction engine features
        const result = 2 + 2;
        expect(result).to.equal(4);
    });
}); 