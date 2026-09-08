import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ReportSheet } from '../../components/safety/ReportSheet';
import { useSafetyStore } from '../../store/safetyStore';

/**
 * The sheet the Report button on a live room and a video date opens.
 *
 * It did not exist. `safetyStore.openReportModal` set `isReportModalOpen` and
 * `reportTarget`, and NOTHING in the app read either — chat has its own local
 * modal, which is why chat kept working. So on the two highest-stakes surfaces
 * in the product, a woman tapped Report and nothing happened: no sheet, no
 * report, no error. Her screen reader had just told her "Report. Reports are
 * anonymous — she is never told."
 *
 * That is worse than the 2026-08 bug this codebase already has a postmortem
 * for. That one filed nothing and said it had. This one does not even pretend.
 */

const mockSubmit = jest.fn();
const mockClose = jest.fn();

function seed(over: Record<string, unknown> = {}) {
  useSafetyStore.setState({
    isReportModalOpen: true,
    reportTarget: { userId: 'u-host', contentType: 'room', contentId: 'r1' },
    submitReport: mockSubmit,
    closeReportModal: mockClose,
    ...over,
  } as never);
}

beforeEach(() => {
  mockSubmit.mockReset().mockResolvedValue(undefined);
  mockClose.mockReset();
  seed();
});

describe('ReportSheet', () => {
  it('renders nothing when nothing is being reported', () => {
    seed({ isReportModalOpen: false, reportTarget: null });
    const { queryByTestId } = render(<ReportSheet />);
    expect(queryByTestId('report-sheet')).toBeNull();
  });

  it('opens when the store says a report is in progress', () => {
    const { getByTestId } = render(<ReportSheet />);
    expect(getByTestId('report-sheet')).toBeTruthy();
  });

  it('says the report is anonymous, because the button already promised that', () => {
    const { getByText } = render(<ReportSheet />);
    expect(getByText(/anonymous/i)).toBeTruthy();
  });

  it('will not submit until she has chosen a reason', async () => {
    const { getByTestId } = render(<ReportSheet />);
    fireEvent.press(getByTestId('report-submit'));
    await waitFor(() => expect(mockSubmit).not.toHaveBeenCalled());
  });

  it('submits the reason she chose', async () => {
    const { getByTestId } = render(<ReportSheet />);
    fireEvent.press(getByTestId('report-reason-harassment'));
    fireEvent.press(getByTestId('report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith('harassment', undefined));
  });

  it('closes only after the write actually succeeded', async () => {
    const { getByTestId } = render(<ReportSheet />);
    fireEvent.press(getByTestId('report-reason-spam'));
    fireEvent.press(getByTestId('report-submit'));
    await waitFor(() => expect(mockClose).toHaveBeenCalled());
  });

  it('stays open and says so when the report failed', async () => {
    // submitReport throws on a refused write. Closing anyway would be the exact
    // "Report submitted 💜 over nothing" bug this app already shipped once.
    mockSubmit.mockRejectedValue(new Error('offline'));
    const { getByTestId } = render(<ReportSheet />);
    fireEvent.press(getByTestId('report-reason-other'));
    fireEvent.press(getByTestId('report-submit'));

    await waitFor(() => expect(getByTestId('report-error')).toBeTruthy());
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('lets her back out without filing anything', () => {
    const { getByTestId } = render(<ReportSheet />);
    fireEvent.press(getByTestId('report-cancel'));
    expect(mockClose).toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
