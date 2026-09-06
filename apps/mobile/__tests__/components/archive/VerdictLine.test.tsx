import { render } from '@testing-library/react-native';
import { VerdictLine } from '../../../components/archive/VerdictLine';
import { formatScore } from '../../../lib/archive';

describe('VerdictLine', () => {
  it('renders the prototype verdict for each band', () => {
    expect(render(<VerdictLine score={formatScore(92, 100)} />).getByText('Community favourite')).toBeTruthy();
    expect(render(<VerdictLine score={formatScore(80, 100)} />).getByText('Worth your night')).toBeTruthy();
    expect(render(<VerdictLine score={formatScore(60, 100)} />).getByText('Divisive')).toBeTruthy();
    expect(render(<VerdictLine score={formatScore(20, 100)} />).getByText('Most of us said skip it')).toBeTruthy();
  });

  it('renders NOTHING when nobody has rated it', () => {
    // There is no verdict to give. A sentence here would be the app inventing
    // an opinion out of an empty column.
    const v = render(<VerdictLine score={formatScore(0, 0)} />);
    expect(v.toJSON()).toBeNull();
  });

  it('renders a verdict from the first rating, with the count beside it', () => {
    const v = render(<VerdictLine score={formatScore(1, 3)} />);
    expect(v.getByText('Most of us said skip it')).toBeTruthy();
    // The sample size is never hidden — that is what keeps a verdict off three
    // votes honest rather than authoritative.
    expect(v.getByText('3 members voted')).toBeTruthy();
  });

  it('says how many members voted', () => {
    expect(render(<VerdictLine score={formatScore(84, 100)} />).getByText('100 members voted')).toBeTruthy();
  });

  it('adds the review half only when it is given one', () => {
    const v = render(<VerdictLine score={formatScore(84, 100)} reviewCount={12} />);
    expect(v.getByText('100 members voted · 12 wrote reviews')).toBeTruthy();
  });

  it('carries the product line under it', () => {
    const v = render(<VerdictLine score={formatScore(84, 100)} />);
    expect(v.getByText('One score, one question. No critics, no stars.')).toBeTruthy();
  });
});
