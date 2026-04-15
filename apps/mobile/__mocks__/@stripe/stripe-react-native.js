const useStripe = () => ({
  initPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
  presentPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
  confirmPayment: jest.fn().mockResolvedValue({ paymentIntent: null, error: null }),
});

const StripeProvider = ({ children }) => children;

module.exports = { useStripe, StripeProvider };
