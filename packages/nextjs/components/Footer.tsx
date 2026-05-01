import React from "react";
import { SwitchTheme } from "~~/components/SwitchTheme";

/**
 * Site footer
 */
export const Footer = () => {
  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      <div>
        <div className="fixed flex justify-end items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
          <SwitchTheme className="pointer-events-auto" />
        </div>
      </div>
      <div className="w-full">
        <div className="flex justify-center items-center text-center text-xs opacity-70 px-4 py-2">
          <p className="m-0">
            Made by one community member with the help of LeftClaw Services beta. Use at your own risk.
          </p>
        </div>
      </div>
    </div>
  );
};
