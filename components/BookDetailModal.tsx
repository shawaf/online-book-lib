"use client";

import { Book, Section } from "@/data/books";
import { useEffect } from "react";

interface Props {
  book: Book;
  section: Section;
  onClose: () => void;
  onBack: () => void;
}

export default function BookDetailModal({ book, section, onClose, onBack }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "linear-gradient(160deg, #fdf6e3, #f0d9a0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top book visual */}
        <div
          className="p-8 flex flex-col items-center"
          style={{ background: `linear-gradient(135deg, ${book.color}, ${book.color}cc)` }}
        >
          <div
            className="w-32 h-44 rounded-sm shadow-2xl flex items-end justify-center pb-3 mb-4 relative overflow-hidden"
            style={{ background: `linear-gradient(to right, ${book.color}66, ${book.color})` }}
          >
            {/* Book cover detail lines */}
            <div className="absolute inset-0 flex flex-col justify-center items-center gap-1 opacity-20">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="w-3/4 h-px bg-white" />
              ))}
            </div>
            <div className="absolute top-3 left-3 right-3 text-center">
              <p className="text-white text-xs font-bold leading-tight drop-shadow">{book.titleAr}</p>
            </div>
            <p className="text-white/70 text-xs relative z-10">{section.icon}</p>
          </div>
          <h2 className="text-white text-xl font-bold text-center">{book.title}</h2>
          <p className="text-white/80 text-sm">{book.titleAr}</p>
        </div>

        {/* Details */}
        <div className="p-6 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 p-3 rounded-xl bg-white/60">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Author</p>
              <p className="font-semibold text-gray-800">{book.author}</p>
              <p className="text-sm text-gray-500">{book.authorAr}</p>
            </div>
            <div className="p-3 rounded-xl bg-white/60">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Year</p>
              <p className="font-semibold text-gray-800">{book.year ?? "Classical"}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white/60">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">About</p>
            <p className="text-gray-700 leading-relaxed">{book.description}</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 rounded-xl font-semibold transition-all hover:opacity-80"
              style={{ background: `${book.color}22`, color: book.color }}
            >
              ← Back to Shelf
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-80"
              style={{ background: book.color }}
            >
              Return to Library
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
