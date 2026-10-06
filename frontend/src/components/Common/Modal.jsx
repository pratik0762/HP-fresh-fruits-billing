import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-3xl', bodyClassName = '', bodyStyle, backdropClassName = 'bg-slate-900/60 backdrop-blur-sm' }) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${backdropClassName} flex items-start sm:items-center justify-center p-0 sm:p-4 lg:p-6 animate-fadeIn print:static print:bg-transparent print:p-0 print:block print:overflow-visible print:transform-none print:backdrop-filter-none print:animate-none`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white w-full ${maxWidth} sm:rounded-2xl shadow-2xl border border-slate-100 overflow-hidden transform transition-all print:shadow-none print:border-0 print:max-w-none print:w-full print:overflow-visible print:transform-none`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar — hidden when printing */}
        <div className="no-print flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Body: scrolls on screen, full flow while printing (no max-height clipping) */}
        <div
          className={`p-4 sm:p-6 max-h-[85vh] sm:max-h-[80vh] overflow-y-auto print:max-h-none print:overflow-visible ${bodyClassName}`}
          style={bodyStyle}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
