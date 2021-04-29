const path = require('path')

const BundleAnalyzerPlugin = require('webpack-bundle-analyzer')
  .BundleAnalyzerPlugin

module.exports = {
  mode: 'development',
  entry: {
    // index: './src/index.ts',
    test: './src/test.ts',
    agenda: './src/agenda-test.ts'
  },
  cache: false,
  target: 'node',
  output: {
    path: path.join(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  },
  // plugins: [new BundleAnalyzerPlugin()],
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        include: path.resolve(__dirname, 'src'),
        exclude: /node_modules/
      },
      { test: /\.https?$/, loader: 'ignore-loader' }
    ],
    unknownContextRequest: '.'
  },
  resolve: {
    extensions: ['.ts', '.js']
  }
}
