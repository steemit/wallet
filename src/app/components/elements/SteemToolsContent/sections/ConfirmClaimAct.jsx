import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const ConfirmClaimAct = ({ operation }) => {
    const { account, payment, fee, claimAmount, claimable, rcPerAct, steemPerAct } = operation;

    const paymentLabel = payment === 'RC' ? tt('steem_tools.claim_act.pay_with_rc') : tt('steem_tools.claim_act.pay_with_steem');

    const perActLabel = payment === 'RC'
        ? String(rcPerAct)
        : String(steemPerAct);

    return (
        <div className="info">
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.claim_act.account')}
                </span>
                <input className="input-group-field" type="text" value={account} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.claim_act.payment')}
                </span>
                <input className="input-group-field" type="text" value={paymentLabel} disabled={true} />
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.claim_act.modal_per_act')}
                </span>
                <input className="input-group-field" type="text" value={perActLabel} disabled={true} />
                <span
                    style={{
                        borderRight: 0,
                        padding: '0.5rem 1rem',
                        border: '1px solid #cacaca',
                        background: '#e6e6e6',
                        color: '#333333',
                        borderRadius: '3px 0 0 3px',
                        maxWidth: 'fit-content'
                    }}
                    >
                    {paymentLabel}
                </span>
            </div>

            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('steem_tools.claim_act.modal_amount')}
                </span>
                <input className="input-group-field" type="text" value={`${claimAmount}`} disabled={true} />
                <span
                    style={{
                        borderRight: 0,
                        padding: '0.5rem 1rem',
                        border: '1px solid #cacaca',
                        background: '#e6e6e6',
                        color: '#333333',
                        borderRadius: '3px 0 0 3px',
                        maxWidth: 'fit-content'
                    }}
                    >
                    {tt('steem_tools.claim_act.act_suffix')}
                </span>
            </div>
        </div>
    );
};



ConfirmClaimAct.propTypes = {
    operation: PropTypes.shape({
        account: PropTypes.string.isRequired,
        payment: PropTypes.oneOf(['RC', 'STEEM']).isRequired,
        fee: PropTypes.string.isRequired,
        claimAmount: PropTypes.number.isRequired,
        claimable: PropTypes.number.isRequired,
        rcPerAct: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        steemPerAct: PropTypes.string.isRequired,
    }).isRequired,
};

export default ConfirmClaimAct;
