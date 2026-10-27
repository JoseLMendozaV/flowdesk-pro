import { createElement, forwardRef, type ComponentType, type JSX, type ReactNode } from "react";

/**
 * Sustituto mínimo de framer-motion para las pantallas traídas de Control Docente: los
 * elementos `motion.*` se dibujan como elementos normales y se ignoran las propiedades de
 * animación. FlowDesk no necesita esa dependencia para unos pocos fundidos.
 */
type MotionProps = {
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  transition?: unknown;
  layout?: unknown;
  whileHover?: unknown;
  whileTap?: unknown;
};

const ANIMATION_PROPS = new Set(["initial", "animate", "exit", "transition", "layout", "whileHover", "whileTap"]);

type MotionElements = { [Tag in keyof JSX.IntrinsicElements]: ComponentType<JSX.IntrinsicElements[Tag] & MotionProps> };

const cache = new Map<string, ComponentType<Record<string, unknown>>>();

function plain(tag: string) {
  const component = forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
    const rest: Record<string, unknown> = { ref };
    for (const [key, value] of Object.entries(props)) if (!ANIMATION_PROPS.has(key)) rest[key] = value;
    return createElement(tag, rest);
  });
  component.displayName = `motion.${tag}`;
  return component as unknown as ComponentType<Record<string, unknown>>;
}

export const motion = new Proxy({} as MotionElements, {
  get: (_target, tag: string) => {
    if (!cache.has(tag)) cache.set(tag, plain(tag));
    return cache.get(tag);
  },
});

export function AnimatePresence({ children }: { children?: ReactNode; mode?: string }) {
  return <>{children}</>;
}
