"use client";

import { Book, Section } from "@/data/books";
import { useEffect } from "react";

interface Props {
  section: Section;
  onClose: () => void;
  onSelectBook: (book: Book) => void;
}

export default function BookModal({ section, onClose, onSelectBook }: Props) {
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
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-2xl shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #fdf6e3 0%, #f5e6c8 100%)",
          border: `3px solid ${section.color}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 p-5 rounded-t-xl flex items-center gap-3"
          style={{ background: section.color }}
        >
          <span className="text-3xl">{section.icon}</span>
          <div>
            <h2 className="text-white text-xl font-bold">{section.title}</h2>
            <p className="text-white/80 text-sm font-arabic">{section.titleAr}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-9 h-9 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Books grid */}
        <div className="p-5 grid grid-cols-1 gap-4">
          {section.books.map((book) => (
            <button
              key={book.id}
              onClick={() => onSelectBook(book)}
              className="text-left flex gap-4 p-4 rounded-xl hover:shadow-lg transition-all hover:-translate-y-0.5"
              style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${book.color}30` }}
            >
              {/* Book spine */}
              <div
                className="flex-shrink-0 rounded flex items-center justify-center text-white text-xs font-bold"
                style={{
                  background: book.color,
                  width: book.thickness === 3 ? "48px" : book.thickness === 2 ? "36px" : "28px",
                  minHeight: "80px",
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                  padding: "8px 4px",
                  fontSize: "9px",
                }}
              >
                {book.titleAr}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800">{book.title}</h3>
                <p className="text-sm text-gray-500 mb-1">{book.author} · {book.year}</p>
                <p className="text-sm text-gray-600 line-clamp-2">{book.description}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-center text-gray-400 text-xs pb-4">Press ESC to close</p>
      </div>
    </div>
  );
}
