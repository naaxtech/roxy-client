const React = require('react');
const { View } = require('react-native');

const Image = ({ testID, style, placeholder, contentFit, ...rest }) =>
  React.createElement(View, { testID, style, ...rest });

module.exports = { Image };
