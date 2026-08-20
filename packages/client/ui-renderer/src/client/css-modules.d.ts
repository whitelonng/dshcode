/** CSS-module import surface (typed as CSSModuleClasses by the bundler). */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
