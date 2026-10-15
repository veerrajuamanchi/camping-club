import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostRsvpDutyModal } from './PostRsvpDutyModal';

describe('PostRsvpDutyModal', () => {
  it('does not ask satisfied daily members to select duties', () => {
    render(<PostRsvpDutyModal tripTitle="QA Camp" dailyTarget={4} dailySatisfied={true} onChooseDuties={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No additional task selections are needed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose My Duties/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
