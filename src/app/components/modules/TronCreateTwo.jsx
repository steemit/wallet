import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import PdfDownload from 'app/components/elements/PdfDownload';
import { decryptedTronToken } from 'server/tronAccount';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
    },
};

class TronCreateTwo extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideTronCreateSuccess();
            sessionStorage.removeItem('tron_public_key');
            sessionStorage.removeItem('tron_private_key');
        };
    }

    render() {
        const tron_public = decryptedTronToken(
            sessionStorage.getItem('tron_public_key')
        );
        const tron_private = decryptedTronToken(
            sessionStorage.getItem('tron_private_key')
        );
        const username = sessionStorage.getItem('username');
        // console.log('private key ='+tron_private+"  public key="+tron_public);
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.create_tron_success')}</h3>
                </div>
                <div style={styles.container}>
                    <div>{tt('tron_jsx.create_tron_success_content')}</div>
                    <div>
                        <PdfDownload
                            name={username}
                            tron_public_key={tron_public}
                            tron_private_key={tron_private}
                            newUser={false}
                            widthInches={8.5}
                            heightInches={11.0}
                            label="click download"
                            link={true}
                            download={this.props.tron_user}
                        />
                    </div>
                    <div>{tt('tron_jsx.update_success_content2')}</div>
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                    >
                        {tt('tron_jsx.safe_save_button')}
                    </button>
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const currentUser = state.user.get('current');
        const tron_user =
            currentUser && currentUser.has('tron_user')
                ? currentUser.get('tron_user')
                : false;
        return {
            ...ownProps,
            tron_user,
        };
    },
    dispatch => ({
        hideTronCreateSuccess: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideTronCreateSuccess());
        },
    })
)(TronCreateTwo);
