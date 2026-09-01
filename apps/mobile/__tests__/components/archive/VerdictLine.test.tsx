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

  it('renders NOTHING below the gate', () => {
    // A verdict under an unscored entry is the gate defeated by the sentence
    // under it: "Most of us said skip it" off three votes is a lie with the
    // number withheld.
    const v = render(<VerdictLine score={formatScore(1, 3)} />);
    expect(v.toJSON()).toBeNull();
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
