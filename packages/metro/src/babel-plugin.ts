import type { NodePath } from '@babel/traverse';
import type { PluginObj, types as BabelTypes } from '@babel/core';

const rnHarnessOptimizerPlugin = ({
  types: t,
}: typeof import('@babel/core')): PluginObj => {
  return {
    name: 'react-native-harness-babel-plugin',
    visitor: {
      // Replace global.RN_HARNESS with the configured value
      MemberExpression(path: NodePath<BabelTypes.MemberExpression>) {
        const { node } = path;

        // Check if this is global.RN_HARNESS
        if (
          t.isIdentifier(node.object, { name: 'global' }) &&
          t.isIdentifier(node.property, { name: 'RN_HARNESS' })
        ) {
          const rnHarnessValue = process.env.RN_HARNESS;

          if (typeof rnHarnessValue === 'boolean') {
            path.replaceWith(t.booleanLiteral(rnHarnessValue));
          }
        }
      },

      // Optimize conditional expressions (ternary operators) - run after member expressions
      ConditionalExpression: {
        exit(path: NodePath<BabelTypes.ConditionalExpression>) {
          const { node } = path;

          // If the test is a boolean literal, we can eliminate the dead branch
          if (t.isBooleanLiteral(node.test)) {
            const result = node.test.value ? node.consequent : node.alternate;
            path.replaceWith(result);
          }
        },
      },
    },
  };
};

export default rnHarnessOptimizerPlugin;
