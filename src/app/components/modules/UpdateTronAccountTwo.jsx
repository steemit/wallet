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
class UpdateTronAccountTwo extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideUpdateSuccess();
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
                    <h3>{tt('tron_jsx.update_success')}</h3>
                </div>
                <div style={styles.container}>
                    <div>{tt('tron_jsx.update_success_content')}</div>
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
    state => ({}),
    dispatch => ({
        hideUpdateSuccess: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideUpdateSuccess());
        },
    })
)(UpdateTronAccountTwo);
