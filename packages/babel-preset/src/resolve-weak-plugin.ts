import type { PluginObj, types as BabelTypes, NodePath } from '@babel/core';

// Functions that need their first parameter wrapped with require.resolveWeak
const FUNCTIONS_REQUIRING_RESOLVE_WEAK = [
  'mock',
  'unmock',
  'requireActual',
] as const;

const resolveWeakPlugin = ({
  types: t,
}: typeof import('@babel/core')): PluginObj => {
  // Track imports from react-native-harness for require.resolveWeak transformation
  const importedNames = new Set<string>();

  return {
    name: 'react-native-harness-resolve-weak-plugin',
    visitor: {
      // Track imports from react-native-harness
      ImportDeclaration(path: NodePath<BabelTypes.ImportDeclaration>) {
        const { node } = path;

        if (node.source.value === 'react-native-harness') {
          // Track all imported names
          node.specifiers.forEach((spec) => {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)) {
              importedNames.add(spec.imported.name);
            }
          });
        }
      },

      // Transform requireActual, mock, and unmock calls to use require.resolveWeak
      CallExpression(path: NodePath<BabelTypes.CallExpression>) {
        const { node } = path;

        // Check if this is a call to requireActual, mock, or unmock
        if (t.isIdentifier(node.callee)) {
          const functionName = node.callee.name;

          // Only transform if the function was imported from react-native-harness
          if (
            importedNames.has(functionName) &&
            FUNCTIONS_REQUIRING_RESOLVE_WEAK.includes(functionName as any)
          ) {
            const firstArg = node.arguments[0];

            // Only transform if the first argument is a string literal
            if (t.isStringLiteral(firstArg)) {
              const modulePath = firstArg.value;

              // Create require.resolveWeak call
              const requireWeakCall = t.callExpression(
                t.memberExpression(
                  t.identifier('require'),
                  t.identifier('resolveWeak')
                ),
                [t.stringLiteral(modulePath)]
              );

              // Replace the first argument with require.resolveWeak call
              const newArguments = [
                requireWeakCall,
                ...node.arguments.slice(1),
              ];

              // Create new call expression
              const newCallExpression = t.callExpression(
                node.callee,
                newArguments
              );

              path.replaceWith(newCallExpression);
            }
          }
        }
      },
    },
  };
};

export default resolveWeakPlugin;
