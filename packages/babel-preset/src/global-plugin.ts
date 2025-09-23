import type { PluginObj, types as BabelTypes, NodePath } from '@babel/core';

const globalRnHarnessPlugin = ({
  types: t,
}: typeof import('@babel/core')): PluginObj => {
  return {
    name: 'react-native-harness-global-plugin',
    visitor: {
      // Replace global.RN_HARNESS with the configured value (only reads, not assignments)
      MemberExpression(path: NodePath<BabelTypes.MemberExpression>) {
        const { node } = path;

        // Check if this is global.RN_HARNESS
        if (
          t.isIdentifier(node.object, { name: 'global' }) &&
          t.isIdentifier(node.property, { name: 'RN_HARNESS' })
        ) {
          // Only transform reads, not assignments
          // Check if this member expression is the left side of an assignment
          const parent = path.parent;
          if (t.isAssignmentExpression(parent) && parent.left === node) {
            // This is an assignment like: global.RN_HARNESS = value
            // Skip transformation
            return;
          }

          const rnHarnessValue = !!process.env.RN_HARNESS;
          path.replaceWith(t.booleanLiteral(rnHarnessValue));
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

export default globalRnHarnessPlugin;
