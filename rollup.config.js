import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import { terser } from "rollup-plugin-terser";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import dts from "rollup-plugin-dts";

const external = ["react", "zustand"];

export default [
  // 主包
  {
    input: "src/index.ts",
    output: [
      { file: "dist/index.js", format: "cjs", sourcemap: true },
      { file: "dist/index.esm.js", format: "esm", sourcemap: true },
    ],
    external,
    plugins: [
      peerDepsExternal(),
      resolve(),
      commonjs(),
      typescript(),
      terser(),
    ],
  },
  // react 子包
  {
    input: "src/react.ts",
    output: [
      { file: "dist/react/index.js", format: "cjs", sourcemap: true },
      { file: "dist/react/index.esm.js", format: "esm", sourcemap: true },
    ],
    external,
    plugins: [
      peerDepsExternal(),
      resolve(),
      commonjs(),
      typescript(),
      terser(),
    ],
  },
  // 类型声明
  {
    input: "src/index.ts",
    output: [{ file: "dist/index.d.ts", format: "es" }],
    plugins: [dts()],
    external,
  },
  {
    input: "src/react.ts",
    output: [{ file: "dist/react/index.d.ts", format: "es" }],
    plugins: [dts()],
    external,
  },
];
