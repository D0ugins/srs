import { useState, useRef } from "react";

interface AutocompleteProps<T> {
    value: string;
    onChange: (value: string) => void;
    options: T[];
    getOptionLabel: (option: T) => string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export function Autocomplete<T>({
    value,
    onChange,
    options,
    getOptionLabel,
    placeholder = "",
    disabled = false,
    className = ""
}: AutocompleteProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const filteredOptions = options.filter(option =>
        getOptionLabel(option).toLowerCase().includes(searchTerm.toLowerCase())
    );

    const exactMatch = filteredOptions.some(option =>
        getOptionLabel(option).toLowerCase() === searchTerm.toLowerCase()
    );

    const showCreateOption = searchTerm.trim() !== '' && !exactMatch;
    const showDropdown = isOpen && (filteredOptions.length > 0 || showCreateOption);

    const handleFocus = () => {
        setIsOpen(true);
        setSearchTerm(value);
    };

    const handleBlur = () => {
        setTimeout(() => setIsOpen(false), 200);
    };

    const handleChange = (newValue: string) => {
        onChange(newValue);
        setSearchTerm(newValue);
    };

    const handleSelect = (option: T) => {
        const label = getOptionLabel(option);
        onChange(label);
        setIsOpen(false);
    };

    const handleCreateNew = () => {
        onChange(searchTerm);
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && isOpen) {
            e.preventDefault();
            if (filteredOptions.length > 0) {
                handleSelect(filteredOptions[0]);
            } else if (showCreateOption) {
                handleCreateNew();
            }
        }
    };

    return (
        <div className="relative w-full">
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className={className}
            />
            {showDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
                    {filteredOptions.map((option, index) => (
                        <div
                            key={index}
                            className="px-3 py-2 hover:bg-blue-100 cursor-pointer text-sm"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelect(option);
                            }}
                        >
                            {getOptionLabel(option)}
                        </div>
                    ))}
                    {showCreateOption && (
                        <div
                            className="px-3 py-2 hover:bg-green-50 cursor-pointer text-sm border-b border-gray-200 flex items-center gap-2"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleCreateNew();
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>


                            <span>Create "{searchTerm}"</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
