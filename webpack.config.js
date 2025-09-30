const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const commonConfig = {
  mode: 'production',
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.css']
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
    }),
    new MiniCssExtractPlugin({
      filename: 'styles.css'
    })
  ],
  optimization: {
    minimize: true
  }
};

const extensionConfig = {
  ...commonConfig,
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    ...commonConfig.resolve,
    mainFields: ['main', 'module'],
    conditionNames: ['require', 'node', 'default'],
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/"),
      "url": require.resolve("url/"),
      "querystring": require.resolve("querystring-es3"),
      "buffer": require.resolve("buffer/")
    }
  },
  plugins: [
    ...commonConfig.plugins,
    new CopyWebpackPlugin({
      patterns: [
        { from: path.resolve(__dirname, 'src/auth/callback.html'), to: path.resolve(__dirname, 'dist') }
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ],
        exclude: /node_modules/
      },
      {
        test: /\.node$/,
        use: 'node-loader'
      }
    ]
  }
};

const webviewConfig = {
  ...commonConfig,
  target: ['web', 'es2020'],
  entry: './src/webview/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview.js',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  resolve: {
    ...commonConfig.resolve,
    fallback: {
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "assert": require.resolve("assert/"),
      "os": require.resolve("os-browserify/browser"),
      "constants": require.resolve("constants-browserify"),
      "url": require.resolve("url/"),
      "querystring": require.resolve("querystring-es3"),
      "vm": require.resolve("vm-browserify"),
      "process": require.resolve("process/browser"),
      "fs": false,
      "child_process": false,
      "net": false,
      "tls": false,
      "dns": false,
      "http2": false,
      "buffer": require.resolve("buffer/")
    }
  },
  plugins: [
    ...commonConfig.plugins,
    new webpack.ProvidePlugin({
      process: require.resolve('process/browser'),
      Buffer: ['buffer', 'Buffer'],
      zlib: 'browserify-zlib'
    })
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ],
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              modules: false
            }
          }
        ]
      }
    ]
  }
};

// SQL Editor configuration with CodeMirror
const sqlEditorConfig = {
  ...commonConfig,
  target: ['web', 'es2020'],
  entry: './src/webview/simpleSqlEditor.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'embeddedSqlEditor.js',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  resolve: {
    ...commonConfig.resolve,
    fallback: {
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "assert": require.resolve("assert/"),
      "os": require.resolve("os-browserify/browser"),
      "constants": require.resolve("constants-browserify"),
      "url": require.resolve("url/"),
      "querystring": require.resolve("querystring-es3"),
      "vm": require.resolve("vm-browserify"),
      "process": require.resolve("process/browser"),
      "fs": false,
      "child_process": false,
      "net": false,
      "tls": false,
      "dns": false,
      "http2": false,
      "buffer": require.resolve("buffer/")
    }
  },
  plugins: [
    ...commonConfig.plugins,
    new webpack.ProvidePlugin({
      process: require.resolve('process/browser'),
      Buffer: ['buffer', 'Buffer']
    })
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ],
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              modules: false
            }
          }
        ]
      }
    ]
  }
};

module.exports = [extensionConfig, webviewConfig, sqlEditorConfig];