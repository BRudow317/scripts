import React from 'react';

// 1. Define the interface using React.ReactNode
interface ContainerProps {
  children: React.ReactNode;
  className?: string;
}

// 2. Apply the props interface to your functional component
export function CardContainer({ children, className = '' }: ContainerProps) {
  return (
    <div className={`card-wrapper ${className}`}>
      {children}
    </div>
  );
}

// 3. Usage Example (accepts deeply nested HTML structures perfectly)
export function App() {
  return (
    <CardContainer className="hero-section">
      <main>
        <h1>Main Title</h1>
        <section>
          <p>Paragraph text inside a nested section.</p>
          <ul>
            <li>Nested list item</li>
          </ul>
        </section>
      </main>
    </CardContainer>
  );
}
