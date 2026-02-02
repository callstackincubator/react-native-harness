import type { PluginObj, types as BabelTypes, NodePath } from '@babel/core';

const collapsiblePlugin = ({
	types: t,
}: typeof import('@babel/core')): PluginObj => {
	return {
		name: 'react-native-harness-collapsible-plugin',
		visitor: {
			JSXOpeningElement(path: NodePath<BabelTypes.JSXOpeningElement>) {
				const { node } = path;

				// 1. Check if the tag is named "View"
				if (t.isJSXIdentifier(node.name) && node.name.name === 'View') {
					// 2. Check if 'collapsable' is already defined to avoid overriding explicit props
					const hasCollapsable = node.attributes.some(
						(attr) =>
							t.isJSXAttribute(attr) &&
							t.isJSXIdentifier(attr.name) &&
							attr.name.name === 'collapsable'
					);

					if (!hasCollapsable) {
						// 3. Inject collapsable={true}
						node.attributes.push(
							t.jsxAttribute(
								t.jsxIdentifier('collapsable'),
								t.jsxExpressionContainer(t.booleanLiteral(true))
							)
						);
					}
				}
			},
		},
	};
};

export default collapsiblePlugin;
